import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { alert, auditEvent, memoryItem, message, thread } from "../apps/hub/src/db/schema.js";
import { appendAudit } from "../apps/hub/src/domain/audit.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

// A full page is not a longer list: Older shows only when a row is left, and the page after it is never empty.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const ago = (min: number) => new Date(Date.now() - min * 60_000);
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const get = async (path: string) => (await fetch(`${hub.url}${path}`, { headers: { cookie: team.lea.cookie } })).text();
// The link that pages back carries ?before= (a list's "Older", a thread's "Older messages").
const older = (html: string) => html.match(/href="([^"]+[?&;]before=[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");

it("pages alerts: no Older link at exactly 50, and one row on the next page at 51", async () => {
  const row = (i: number) => ({
    id: `alr_${i}`,
    teamId: team.teamId,
    kind: "instruction_like" as const,
    excerpt: `alert number ${i}.`,
    createdAt: ago(i),
  });
  await hub.db.insert(alert).values(Array.from({ length: 50 }, (_, i) => row(i)));
  expect(older(await get("/console/alerts"))).toBeUndefined();
  await hub.db.insert(alert).values(row(50));
  const first = await get("/console/alerts");
  expect(first).not.toContain("alert number 50.");
  const next = await get(older(first) ?? "/missing");
  expect(next).toContain("alert number 50.");
  expect(next).not.toContain("alert number 49.");
});

it("pages memory: no Older link at exactly 50, and one row on the next page at 51", async () => {
  const row = (i: number) => ({
    id: `mem_${i}`,
    teamId: team.teamId,
    number: i + 1,
    kind: "note" as const,
    title: `memory number ${i}.`,
    body: "b",
    proposedByUser: team.lea.userId,
    authoredBy: "human" as const,
    createdAt: ago(i),
  });
  await hub.db.insert(memoryItem).values(Array.from({ length: 50 }, (_, i) => row(i)));
  expect(older(await get("/console/memory?status=all"))).toBeUndefined();
  await hub.db.insert(memoryItem).values(row(50));
  const first = await get("/console/memory?status=all");
  expect(first).not.toContain("memory number 50.");
  const next = await get(older(first) ?? "/missing");
  expect(next).toContain("memory number 50.");
  expect(next).not.toContain("memory number 49.");
});

it("pages threads: no Older link at exactly 50, and one row on the next page at 51", async () => {
  const row = (i: number) => ({
    id: `thr_${i}`,
    teamId: team.teamId,
    kind: "team" as const,
    subject: `thread number ${i}.`,
    createdByUser: team.lea.userId,
    lastMessageAt: ago(i),
  });
  await hub.db.insert(thread).values(Array.from({ length: 50 }, (_, i) => row(i)));
  expect(older(await get("/console/threads?project="))).toBeUndefined();
  await hub.db.insert(thread).values(row(50));
  const first = await get("/console/threads?project=");
  expect(first).not.toContain("thread number 50.");
  const next = await get(older(first) ?? "/missing");
  expect(next).toContain("thr_50");
  expect(next).not.toContain("thr_49");
});

it("pages a thread: its latest 50 messages, oldest first, and the 51st on the next page", async () => {
  await hub.db.insert(thread).values({ id: "thr_long", teamId: team.teamId, kind: "team", createdByUser: team.lea.userId });
  const row = (i: number) => ({
    id: `msg_long${i}`,
    teamId: team.teamId,
    threadId: "thr_long",
    fromUserId: team.lea.userId,
    authoredBy: "human" as const,
    kind: "note",
    priority: "normal",
    to: ["@team"],
    body: `message number ${i}.`,
    createdAt: ago(i),
  });
  await hub.db.insert(message).values(Array.from({ length: 50 }, (_, i) => row(i)));
  expect(older(await get("/console/threads/thr_long"))).toBeUndefined();
  await hub.db.insert(message).values(row(50));
  const first = await get("/console/threads/thr_long");
  expect(first).not.toContain("message number 50.");
  expect(first.indexOf("message number 49.")).toBeLessThan(first.indexOf("message number 0."));
  const next = await get(older(first) ?? "/missing");
  expect(next).toContain("message number 50.");
  expect(next).not.toContain("message number 49.");
});

it("pages the audit log: no Older link at exactly 50, and one row on the next page at 51", async () => {
  const total = async () => (await hub.db.select({ n: count() }).from(auditEvent).where(eq(auditEvent.teamId, team.teamId)))[0]?.n ?? 0;
  const append = (n: number) =>
    hub.db.transaction(async (tx) => {
      for (let i = 0; i < n; i++) await appendAudit(tx, { teamId: team.teamId, actorType: "hub", via: "system", action: "test.filler" });
    });
  await append(50 - (await total()));
  expect(await total()).toBe(50);
  expect(older(await get("/console/audit"))).toBeUndefined();
  await append(1);
  const next = await get(older(await get("/console/audit")) ?? "/missing");
  expect(next.match(/<tr>/g)).toHaveLength(2);
});
