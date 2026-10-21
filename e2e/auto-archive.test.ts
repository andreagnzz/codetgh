import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { message, task, thread } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const threads = async (query = "") => (await fetch(`${hub.url}/console/threads${query}`, { headers: { cookie: team.lea.cookie } })).text();

it("hides tasks done for more than a day from task_list unless include_archived is set", async () => {
  await startSession(hub.url, team.lea.token, "lea-arch");
  const lea = await mcpClient(hub.url, team.lea.token);
  const old = JSON.parse((await call(lea, "task_create", { title: "Old finished work" })).text).id;
  const fresh = JSON.parse((await call(lea, "task_create", { title: "Just finished work" })).text).id;
  await hub.db
    .update(task)
    .set({ status: "done", updatedAt: hoursAgo(25) })
    .where(eq(task.id, old));
  await hub.db
    .update(task)
    .set({ status: "done", updatedAt: hoursAgo(1) })
    .where(eq(task.id, fresh));

  const listed = (await call(lea, "task_list")).text;
  expect(listed).not.toContain(old);
  expect(listed).toContain(fresh);
  expect((await call(lea, "task_list", { include_archived: true })).text).toContain(old);

  const board = await (await fetch(`${hub.url}/console/tasks`, { headers: { cookie: team.lea.cookie } })).text();
  expect(board).not.toContain(old);
  expect(board).toContain(fresh);
  expect(await (await fetch(`${hub.url}/console/tasks?archived=1`, { headers: { cookie: team.lea.cookie } })).text()).toContain(old);
});

it("archives an inactive thread with nothing unread, keeps an unread one, and brings it back on a new message", async () => {
  const agent = (await startSession(hub.url, team.lea.token, "lea-arch2", { repo: ACME_REPO })).agent_id;
  await startSession(hub.url, team.sam.token, "sam-arch2", { repo: ACME_REPO });
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(lea, "send_message", { agent, to: "@sam", kind: "note", body: "read and forgotten" });
  await call(lea, "send_message", { agent, to: "@sam", kind: "note", body: "still unread" });
  const [read] = await hub.db.select().from(message).where(eq(message.body, "read and forgotten"));
  const [unread] = await hub.db.select().from(message).where(eq(message.body, "still unread"));
  if (!read || !unread) throw new Error("no messages");
  await call(sam, "ack", { message_ids: [read.id] });
  await hub.db
    .update(thread)
    .set({ lastMessageAt: hoursAgo(25) })
    .where(eq(thread.id, read.threadId));
  await hub.db
    .update(thread)
    .set({ lastMessageAt: hoursAgo(25) })
    .where(eq(thread.id, unread.threadId));

  const current = await threads();
  expect(current).not.toContain(read.threadId);
  expect(current).toContain(unread.threadId);
  const archives = await threads("?archived=1");
  expect(archives).toContain(read.threadId);
  expect(archives).not.toContain(unread.threadId);

  await call(sam, "send_message", { to: `thread:${read.threadId}`, kind: "note", body: "back again" });
  expect(await threads()).toContain(read.threadId);
});
