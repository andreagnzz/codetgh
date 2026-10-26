import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { message } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// ask_peer listens on the bus once its question is sent.
const listening = async () => {
  while (hub.bus.listenerCount("revoked") === 0) await pause(20);
};

it("keeps waiting for the answer when another member is revoked, and stops when the asker is", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);

  let returned = false;
  const asking = call(sam, "ask_peer", { to: "@lea", question: "Still there?", wait_s: 10, allow_offline: true }).then((r) => {
    returned = true;
    return r;
  });
  await listening();
  hub.bus.emit("revoked", { teamId: team.teamId, userId: team.malik.userId });
  await pause(500);
  expect(returned).toBe(false);

  const [question] = await hub.db.select().from(message).where(eq(message.body, "Still there?"));
  await call(lea, "send_message", { kind: "answer", reply_to: question?.id, body: "Yes.", allow_offline: true });
  expect((await asking).json()).toMatchObject({ status: "answered", question_id: question?.id });

  const pending = call(sam, "ask_peer", { to: "@lea", question: "And now?", wait_s: 10, allow_offline: true });
  await listening();
  hub.bus.emit("revoked", { teamId: team.teamId, userId: team.sam.userId });
  expect((await pending).json()).toMatchObject({ status: "pending" });

  await sam.close();
  await lea.close();
});
