import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { message } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("stops two agents that keep opening new threads to each other, but never a human", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  // No reply_to: every message opens a new thread, so the per-thread guard never sees a streak.
  for (let i = 0; i < 12; i++) {
    const [who, to] = i % 2 ? [lea, "@sam"] : [sam, "@lea"];
    const r = await call(who, "send_message", { to, kind: "note", body: `ping ${i}` });
    expect(r.isError).toBe(false);
  }
  const blocked = JSON.parse((await call(sam, "send_message", { to: "@lea", kind: "note", body: "ping 12" })).text);
  expect(blocked.code).toBe("E_LOOP_GUARD");
  expect(blocked.message).toMatch(/between you and @lea/);
  // Other pairs are not affected.
  expect((await call(sam, "send_message", { to: "@malik", kind: "note", body: "hello" })).isError).toBe(false);

  // A human answer from the console still goes through.
  const [last] = await hub.db.select().from(message).where(eq(message.body, "ping 10"));
  expect((await consolePost(hub.url, team.lea.cookie, `/console/threads/${last?.threadId}/reply`, { body: "stop, I'm here" })).status).toBe(
    204,
  );
});
