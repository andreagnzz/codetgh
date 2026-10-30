import { randomUUID } from "node:crypto";
import { Role, TaskState } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { a2aTask, message } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let token = "";
beforeAll(async () => {
  // Many requests by one external agent in a few milliseconds: a clock that moves an hour per call keeps the budgets out.
  let now = 0;
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  const res = await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "Partner" });
  token = (await res.text()).match(/ctgh_[A-Za-z0-9_-]+/)?.[0] ?? "";
});
afterAll(() => hub.stop());

const ask = (body: string, taskId = "") => ({
  tenant: "",
  message: {
    messageId: randomUUID() as string,
    contextId: "",
    taskId,
    role: Role.ROLE_USER,
    parts: [{ content: { $case: "text" as const, value: body }, metadata: undefined, filename: "", mediaType: "text/plain" }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  },
  configuration: undefined,
  metadata: undefined,
});
const auth = () => ({ serviceParameters: { Authorization: `Bearer ${token}` } });

// The SDK stores a follow-up in the task before the hub sends it: refused follow-ups must not grow the row without end.
it("keeps at most 10 messages in a task's history, however many follow-ups are refused", async () => {
  const client = await new ClientFactory().createFromUrl(hub.url);
  const sent = await client.sendMessage(ask("What is your SLA?"), auth());
  const id = "status" in sent ? sent.id : "";
  for (let i = 0; i < 12; i++) {
    const r = await client.sendMessage(ask(`${i} ${"z".repeat(9_000)}`, id), auth());
    expect("status" in r && r.status?.state).toBe(TaskState.TASK_STATE_FAILED);
  }
  const [row] = await hub.db.select().from(a2aTask).where(eq(a2aTask.id, id));
  expect(row?.task.history.length).toBeLessThanOrEqual(10);
});

it("keeps a follow-up's message id at a bounded length", async () => {
  const client = await new ClientFactory().createFromUrl(hub.url);
  const sent = await client.sendMessage(ask("Do you ship on Fridays?"), auth());
  const id = "status" in sent ? sent.id : "";
  const followUp = ask("And on holidays?", id);
  followUp.message.messageId = "m".repeat(50_000);
  await client.sendMessage(followUp, auth());
  const [row] = await hub.db.select().from(a2aTask).where(eq(a2aTask.id, id));
  expect(JSON.stringify(row?.task).length).toBeLessThan(2_000);
});

// An answer completes the task, a terminal state in A2A: the next question opens a new task in the same context.
it("opens a new task in the same context for a question asked after an answer", async () => {
  const client = await new ClientFactory().createFromUrl(hub.url);
  const sent = await client.sendMessage(ask("Which region do you host in?"), auth());
  const first = "status" in sent ? sent : null;
  const lea = await mcpClient(hub.url, team.lea.token);
  const answer = async (question: string, body: string) => {
    const [q] = await hub.db.select().from(message).where(eq(message.body, question));
    await call(lea, "send_message", { reply_to: q?.id, kind: "answer", body });
  };
  await answer("Which region do you host in?", "eu-west.");
  await expect(client.sendMessage(ask("Same task?", first?.id), auth())).rejects.toThrow("terminal state");

  const next = ask("And where are the backups?");
  next.message.contextId = first?.contextId ?? "";
  const resent = await client.sendMessage(next, auth());
  const second = "status" in resent ? resent : null;
  expect(second?.id).not.toBe(first?.id);
  expect(second?.contextId).toBe(first?.contextId);

  await answer("And where are the backups?", "In Frankfurt.");
  await lea.close();
  const after = await client.getTask({ tenant: "", id: second?.id ?? "", historyLength: 10 }, auth());
  const texts = (role: Role) =>
    after.history.filter((m) => m.role === role).flatMap((m) => m.parts.map((p) => (p.content?.$case === "text" ? p.content.value : "")));
  expect(after.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  expect(texts(Role.ROLE_USER)).toEqual(["And where are the backups?"]);
  expect(texts(Role.ROLE_AGENT).join("\n")).toContain("In Frankfurt.");
  expect(texts(Role.ROLE_AGENT).join("\n")).not.toContain("eu-west.");
});

// tasks/list with a context id: the tasks of that conversation only; without one, the agent's latest tasks.
it("lists only the tasks of the context asked for", async () => {
  const client = await new ClientFactory().createFromUrl(hub.url);
  const sent = await client.sendMessage(ask("Do you have a status page?"), auth());
  const first = "status" in sent ? sent : null;
  const other = await client.sendMessage(ask("Who is on call this week?"), auth());
  const list = async (contextId: string) =>
    (
      await client.listTasks(
        { tenant: "", contextId, status: TaskState.TASK_STATE_UNSPECIFIED, pageToken: "", statusTimestampAfter: undefined },
        auth(),
      )
    ).tasks.map((t) => t.id);
  expect(await list(first?.contextId ?? "")).toEqual([first?.id]);
  expect(await list("")).toEqual(expect.arrayContaining([first?.id, "status" in other ? other.id : ""]));
});
