import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, membership, receipt } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const send = (token: string, body: Record<string, unknown>) =>
  fetch(`${hub.url}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "note", body: "ping", allow_offline: true, ...body }),
  });
const received = async (userId: string) => (await hub.db.select().from(receipt).where(eq(receipt.recipientUserId, userId))).length;

it("fans a thread: address out to the active people of the thread only", async () => {
  const first = (await (await send(team.sam.token, { to: "@lea" })).json()) as { id: string; thread: string };
  const dm = first.thread;
  const trio = ((await (await send(team.sam.token, { to: ["@lea", "@malik"] })).json()) as { thread: string }).thread;
  const [samAgent] = await hub.db.select().from(agent).where(eq(agent.userId, team.sam.userId));

  expect((await send(team.lea.token, { to: `thread:${trio}` })).status).toBe(200);
  expect(await received(team.sam.userId)).toBe(1);
  expect(await received(team.malik.userId)).toBe(2);

  const [sam] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
  expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${sam?.id}/revoke`)).status).toBeLessThan(400);

  const toDm = await send(team.lea.token, { to: `thread:${dm}` });
  expect(toDm.status).toBe(400);
  expect(((await toDm.json()) as { code: string }).code).toBe("E_INVALID");
  expect((await send(team.lea.token, { to: `thread:${trio}` })).status).toBe(200);
  expect((await send(team.lea.token, { to: `agent:${samAgent?.id}` })).status).toBe(404);
  // A reply with no to goes to the parent's sender: not once they are gone.
  const reply = await send(team.lea.token, { reply_to: first.id });
  expect(reply.status).toBe(400);
  expect(((await reply.json()) as { code: string }).code).toBe("E_INVALID");

  expect(await received(team.sam.userId)).toBe(1);
  expect(await received(team.malik.userId)).toBe(3);
});
