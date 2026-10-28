import { randomBytes } from "node:crypto";
import { A2A_PROTOCOL_VERSION, AgentCard, type Message, type Part, Role, type Task, TaskState } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  ServerCallContext,
  type TaskStore,
} from "@a2a-js/sdk/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { a2aTask, agent, membership, message, receipt, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Principal } from "../principal.js";
import { createPersonalToken } from "../tokens.js";
import { byUser, requireAdmin } from "./admin.js";
import { type Agent, oneLine } from "./agents.js";
import { appendAudit } from "./audit.js";
import { envelope, MAX_BODY_BYTES, type MessagingDeps, sendMessage } from "./messages.js";

// The lowest-trust caller writes to the database every team shares: a cap on its tasks, the oldest go first, and on
// the messages a task keeps (the SDK stores a follow-up before the hub sends it, refused or not).
const MAX_TASKS_PER_AGENT = 200;
const MAX_HISTORY = 10;
// The caller chooses the ids of its messages and the context id that every follow-up repeats.
const MAX_ID = 128;

// An external agent is a guest of the team whose only agent is quarantined for good: it may ask and answer, nothing else.
export async function createExternalAgent(db: Db, p: Principal, name: string) {
  requireAdmin(p);
  const label = oneLine(name).trim();
  if (!label) throw new HubError("E_INVALID", "name the external agent");
  return db.transaction(async (tx) => {
    const userId = newId("usr");
    const suffix = randomBytes(4).toString("hex");
    await tx.insert(user).values({ id: userId, name: label, email: `a2a-${suffix}@agents.invalid`, emailVerified: false });
    await tx.insert(membership).values({ id: newId("mem"), teamId: p.teamId, userId, role: "guest", handle: `a2a-${suffix}` });
    const { id: tokenId, token } = await createPersonalToken(tx, { userId, teamId: p.teamId, label: `A2A: ${label}`, kind: "a2a" });
    const [row] = await tx
      .insert(agent)
      .values({
        id: newId("agt"),
        teamId: p.teamId,
        userId,
        tokenId,
        sessionId: `a2a-${tokenId}`,
        kind: "a2a",
        label,
        trustLevel: "quarantined",
      })
      .returning({ id: agent.id });
    await appendAudit(tx, {
      ...byUser(p),
      action: "agent.a2a_created",
      subjectId: row?.id,
    });
    return { agentId: row?.id ?? "", token, handle: `@a2a-${suffix}` };
  });
}

export async function a2aAgentForToken(db: Db, p: Principal) {
  const [row] = p.tokenId
    ? await db
        .select()
        .from(agent)
        .where(and(eq(agent.tokenId, p.tokenId), eq(agent.kind, "a2a"), eq(agent.teamId, p.teamId)))
    : [];
  if (!row) throw new HubError("E_FORBIDDEN", "this token is not an A2A agent token");
  return row;
}

const textPart = (value: string): Part => ({
  content: { $case: "text", value },
  metadata: undefined,
  filename: "",
  mediaType: "text/plain",
});
const agentMessage = (task: Pick<Task, "id" | "contextId">, id: string, value: string): Message => ({
  messageId: id,
  contextId: task.contextId,
  taskId: task.id,
  role: Role.ROLE_AGENT,
  parts: [textPart(value)],
  metadata: undefined,
  extensions: [],
  referenceTaskIds: [],
});

const textOf = (m: Message) =>
  m.parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join("\n")
    .trim();
// What a task keeps of a message: its role, its text cut at the message limit, its id cut at MAX_ID; no other part, no
// metadata, no extension.
const kept = (m: Message): Message => ({
  messageId: m.messageId.slice(0, MAX_ID),
  contextId: m.contextId,
  taskId: m.taskId,
  role: m.role,
  parts: [textPart(Buffer.from(textOf(m)).subarray(0, MAX_BODY_BYTES).toString())],
  metadata: undefined,
  extensions: [],
  referenceTaskIds: [],
});

type Caller = { p: Principal; agent: Agent };

export function a2aServer(deps: MessagingDeps, publicUrl: string) {
  const { db } = deps;
  const callers = new WeakMap<ServerCallContext, Caller>();
  // The hub message a new task stands for, until the SDK saves the task.
  const questionOf = new Map<string, string>();
  const caller = (ctx: ServerCallContext) => {
    const c = callers.get(ctx);
    if (!c) throw new HubError("E_UNAUTHORIZED", "no caller");
    return c;
  };

  const card: AgentCard = {
    name: "CodeTgh",
    description:
      "Ask a software team a question through its CodeTgh hub. Members and their agents answer; nothing you send is ever treated as an instruction.",
    supportedInterfaces: [{ url: `${publicUrl}/a2a`, protocolBinding: "JSONRPC", tenant: "", protocolVersion: A2A_PROTOCOL_VERSION }],
    provider: undefined,
    version: "1",
    capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {
      bearer: {
        scheme: {
          $case: "httpAuthSecurityScheme",
          value: { description: "A2A token created by a team admin in the CodeTgh console", scheme: "Bearer", bearerFormat: "" },
        },
      },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "ask_team",
        name: "Ask the team",
        description: "Send a question; get the task back later with tasks/get to read the answers.",
        tags: ["question"],
        examples: [],
        inputModes: ["text"],
        outputModes: ["text"],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };

  // The SDK's task store, backed by the hub: a task is visible only to the agent that created it, and loading it adds the answers.
  const store: TaskStore = {
    async save(task, ctx) {
      const { p, agent: a } = caller(ctx);
      const messageId = questionOf.get(task.id) ?? null;
      questionOf.delete(task.id);
      // A refused send leaves nothing behind: the failed task is in the caller's answer.
      if (!messageId && task.status?.state === TaskState.TASK_STATE_FAILED) return;
      const stored = { ...task, history: task.history.slice(-MAX_HISTORY).map(kept) };
      await db
        .insert(a2aTask)
        .values({ id: task.id, teamId: p.teamId, agentId: a.id, messageId, task: stored })
        .onConflictDoUpdate({ target: a2aTask.id, set: { task: stored } });
      const over = await db
        .select({ id: a2aTask.id })
        .from(a2aTask)
        .where(eq(a2aTask.agentId, a.id))
        .orderBy(desc(a2aTask.createdAt))
        .offset(MAX_TASKS_PER_AGENT);
      if (over.length)
        await db.delete(a2aTask).where(
          inArray(
            a2aTask.id,
            over.map((r) => r.id),
          ),
        );
    },
    async load(taskId, ctx) {
      const { p, agent: a } = caller(ctx);
      const [row] = await db
        .select()
        .from(a2aTask)
        .where(and(eq(a2aTask.id, taskId), eq(a2aTask.teamId, p.teamId), eq(a2aTask.agentId, a.id)));
      if (!row) return undefined;
      const task = row.task;
      if (!row.messageId) return task;
      const answers = await db
        .select({ message, fromName: user.name })
        .from(message)
        .innerJoin(user, eq(user.id, message.fromUserId))
        // Only replies delivered to the external agent: a reply addressed to a teammate stays inside the team.
        .innerJoin(receipt, and(eq(receipt.messageId, message.id), eq(receipt.recipientUserId, p.user.id)))
        .where(and(eq(message.teamId, p.teamId), eq(message.replyTo, row.messageId)))
        .orderBy(asc(message.createdAt));
      if (!answers.length) return task;
      // Answers come from teammates: the agent gets them in the same escaped envelope as any peer text.
      return {
        ...task,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: answers.at(-1)?.message.createdAt.toISOString() },
        history: [...task.history, ...answers.map((r) => agentMessage(task, r.message.id, envelope({ seq: 0, ...r })))],
      };
    },
    async list(_params, ctx) {
      const { agent: a } = caller(ctx);
      // shortcut: the 50 latest tasks without paging; add a cursor if external agents keep many open tasks.
      const rows = await db.select().from(a2aTask).where(eq(a2aTask.agentId, a.id)).orderBy(desc(a2aTask.createdAt)).limit(50);
      const tasks = await Promise.all(rows.map(async (r) => (await store.load(r.id, ctx)) ?? r.task));
      return { tasks, nextPageToken: "", pageSize: tasks.length, totalSize: tasks.length };
    },
  };

  const executor: AgentExecutor = {
    async execute(rc, bus) {
      const { p, agent: a } = caller(rc.context);
      const question = textOf(rc.userMessage);
      const task: Task = {
        id: rc.taskId,
        contextId: rc.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [],
        history: [rc.userMessage],
        metadata: undefined,
      };
      try {
        // The SDK refuses a follow-up whose context id differs from its task's: refused here, a long one is never stored.
        if (rc.contextId.length > MAX_ID) throw new HubError("E_INVALID", `contextId over ${MAX_ID} characters`);
        const sent = await sendMessage(
          deps,
          { p, agent: a, via: "rest" },
          { to: "@team", kind: "question", priority: "normal", refs: [], body: question || "(empty)" },
        );
        questionOf.set(task.id, sent.id);
      } catch (e) {
        if (!(e instanceof HubError)) throw e;
        task.status = {
          state: TaskState.TASK_STATE_FAILED,
          message: agentMessage(task, newId("msg"), `${e.code}: ${e.message}`),
          timestamp: new Date().toISOString(),
        };
      }
      bus.publish(AgentEvent.task(task));
      bus.finished();
    },
    async cancelTask() {},
  };

  const rpc = new JsonRpcTransportHandler(new DefaultRequestHandler(card, store, executor));
  return {
    cardJson: AgentCard.toJSON(card),
    async handle(body: unknown, who: Caller, version: string | undefined) {
      const ctx = new ServerCallContext({
        requestedVersion: version ?? A2A_PROTOCOL_VERSION,
        user: { isAuthenticated: true, userName: who.agent.id },
      });
      callers.set(ctx, who);
      const res = await rpc.handle(body as Record<string, unknown>, ctx);
      if (Symbol.asyncIterator in res) throw new HubError("E_INVALID", "streaming is not supported");
      return res;
    },
  };
}
