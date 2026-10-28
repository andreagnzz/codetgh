import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { a2aTask, message, receipt, team, thread } from "../src/db/schema.js";
import { purgeMessages } from "../src/domain/messages.js";
import { createTeam } from "../src/domain/teams.js";
import { newId } from "../src/ids.js";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
let seeded: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  seeded = await hub.seed();
});
afterAll(() => hub.stop());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function post(teamId: string, userId: string, createdAt: Date) {
  const threadId = newId("thr");
  await hub.db.insert(thread).values({ id: threadId, teamId, kind: "team", createdByUser: userId });
  const id = newId("msg");
  await hub.db.insert(message).values({
    id,
    teamId,
    threadId,
    fromUserId: userId,
    authoredBy: "human",
    kind: "note",
    priority: "normal",
    to: ["@team"],
    body: "hello",
    createdAt,
  });
  await hub.db.insert(receipt).values({ messageId: id, teamId, recipientUserId: userId });
  return id;
}

const exists = async (id: string) => (await hub.db.select({ id: message.id }).from(message).where(eq(message.id, id))).length === 1;

it("deletes messages older than each team's retention, with their receipts", async () => {
  const otherTeam = await createTeam(hub.db, "Long memory");
  await hub.db
    .update(team)
    .set({ settings: { retention_days: 365 } })
    .where(eq(team.id, otherTeam));
  const old = await post(seeded.teamId, seeded.lea.userId, daysAgo(91));
  const recent = await post(seeded.teamId, seeded.lea.userId, daysAgo(1));
  const kept = await post(otherTeam, seeded.lea.userId, daysAgo(91));

  await purgeMessages(hub.db);

  expect(await exists(old)).toBe(false);
  expect(await hub.db.select().from(receipt).where(eq(receipt.messageId, old))).toEqual([]);
  expect(await exists(recent)).toBe(true);
  expect(await exists(kept)).toBe(true);
});

it("deletes external agents' A2A tasks with the messages they stand for", async () => {
  const task = (id: string, createdAt: Date) => ({
    id,
    teamId: seeded.teamId,
    agentId: "agt_external",
    task: { id } as typeof a2aTask.$inferInsert.task,
    createdAt,
  });
  await hub.db.insert(a2aTask).values([task("a2a-old", daysAgo(91)), task("a2a-recent", daysAgo(1))]);

  await purgeMessages(hub.db);

  expect((await hub.db.select({ id: a2aTask.id }).from(a2aTask)).map((r) => r.id)).toEqual(["a2a-recent"]);
});
