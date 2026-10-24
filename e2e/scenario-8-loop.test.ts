import { and, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { alert, message, thread } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("mutes a thread after 5 agent messages in a row and lets a human reopen it (scenario 8)", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  let last = JSON.parse(
    (await call(sam, "send_message", { to: "@lea", kind: "question", body: "Format des dates ?", allow_offline: true })).text,
  );
  for (let i = 1; i <= 4; i++) {
    const who = i % 2 ? lea : sam;
    const r = await call(who, "send_message", { kind: "answer", reply_to: last.id, body: `réponse ${i}` });
    expect(r.isError).toBe(false);
    last = JSON.parse(r.text);
    expect(last.hop).toBe(i);
  }
  // Message 5 (hop 4) was Sam's; Léa's sixth agent message in a row is refused.
  const blocked = await call(lea, "send_message", { kind: "answer", reply_to: last.id, body: "encore" });
  expect(JSON.parse(blocked.text).code).toBe("E_LOOP_GUARD");
  const again = await call(lea, "send_message", { kind: "note", reply_to: last.id, body: "et encore" });
  expect(JSON.parse(again.text).code).toBe("E_LOOP_GUARD");

  const [t] = await hub.db.select().from(thread).where(eq(thread.id, last.thread));
  expect(t?.mutedAt).not.toBeNull();
  expect(
    await hub.db
      .select()
      .from(alert)
      .where(and(eq(alert.kind, "loop_guard"), eq(alert.threadId, last.thread))),
  ).toHaveLength(1);
  const minuteAgo = new Date(Date.now() - 60_000);
  const recent = await hub.db.select().from(message).where(gt(message.createdAt, minuteAgo));
  expect(recent.length).toBeLessThanOrEqual(30);

  // A human reply from the console reopens the thread.
  expect(
    (await consolePost(hub.url, team.lea.cookie, `/console/threads/${last.thread}/reply`, { body: "Stop, on en parle demain." })).status,
  ).toBeLessThan(400);
  const after = await call(lea, "send_message", { kind: "note", reply_to: last.id, body: "ok" });
  expect(after.isError).toBe(false);
  await sam.close();
  await lea.close();
});
