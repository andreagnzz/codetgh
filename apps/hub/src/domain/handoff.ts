import type { Handoff } from "@codetgh/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { membership, memoryItem, task } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import type { Agent } from "./agents.js";
import { appendAudit } from "./audit.js";
import { isExcluded } from "./claims.js";
import { memoryRef } from "./memory.js";
import { type MessagingDeps, sendMessage } from "./messages.js";

// Under the 8 KB message limit, so the escaped envelope still fits the prompt hook's budget.
const MAX_RENDERED_BYTES = 6 * 1024;

const list = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`)] : []);

// Fixed layout: the receiving agent always finds the same sections in the same order.
function renderCapsule(h: Handoff, decisions: Array<{ id: string; ref: string; title: string }>, taskTitle: string | null) {
  return [
    `Handoff${taskTitle ? `: ${taskTitle}` : ""}`,
    "Summary:",
    h.summary,
    ...list("Done", h.done),
    ...list("To do", h.todo),
    ...list(
      "Files touched",
      h.files_touched.map((f) => `${f.path} (${f.change})${f.note ? `: ${f.note}` : ""}`),
    ),
    ...list(
      "Decisions",
      decisions.map((d) => `${d.ref} (${d.id}) ${d.title}`),
    ),
    ...list(
      "Open questions",
      h.open_questions.map((q) => `${q.text}${q.to ? ` (→ ${q.to})` : ""}`),
    ),
    ...list("Commands", h.commands),
    ...list("Warnings", h.warnings),
    ...(h.branch ? [`Branch: ${h.branch}${h.last_commit ? ` @ ${h.last_commit}` : ""}`] : []),
    ...(h.task_id ? [`Task: ${h.task_id}`] : []),
  ].join("\n");
}

export async function sendHandoff(deps: MessagingDeps, p: Principal, a: Agent, h: Handoff) {
  const { db } = deps;
  for (const f of h.files_touched)
    if (isExcluded(f.path)) throw new HubError("E_INVALID", `${f.path} cannot be shared (secrets and .git are excluded)`);
  const decisions = h.decisions.length
    ? await db
        .select()
        .from(memoryItem)
        .where(and(eq(memoryItem.teamId, p.teamId), inArray(memoryItem.id, h.decisions), eq(memoryItem.status, "accepted")))
    : [];
  const unknown = h.decisions.find((id) => !decisions.some((d) => d.id === id));
  if (unknown) throw new HubError("E_INVALID", `${unknown} is not an accepted team decision`);
  const [t] = h.task_id
    ? await db
        .select()
        .from(task)
        .where(and(eq(task.id, h.task_id), eq(task.teamId, p.teamId)))
    : [];
  if (h.task_id && !t) throw new HubError("E_NOT_FOUND", `no task ${h.task_id}`);
  // Same rule as task_update: only the assignee, the creator or an admin hands a task over.
  if (t && t.assigneeUserId !== p.user.id && t.createdByUser !== p.user.id && p.role !== "owner" && p.role !== "admin")
    throw new HubError("E_FORBIDDEN", "only the assignee, the creator or an admin can hand this task over");
  const [recipient] = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(and(eq(membership.teamId, p.teamId), eq(membership.handle, h.to.slice(1)), eq(membership.status, "active")));
  if (!recipient) throw new HubError("E_NOT_FOUND", `no member ${h.to}`);

  const body = renderCapsule(
    h,
    decisions.map((d) => ({ id: d.id, ref: memoryRef(d), title: d.title })),
    t?.title ?? null,
  );
  if (Buffer.byteLength(body) > MAX_RENDERED_BYTES)
    throw new HubError("E_TOO_LARGE", "handoff over 6 KB: shorten the lists and point to files instead");
  const { agent: _agent, to, ...capsule } = h;
  // Same pipeline as any message: kill switch, roles, rate limit, secret scan, loop guard, envelope.
  // A handoff waits for the recipient's next session on the project (its context packet), so it may find none live.
  const sent = await sendMessage(
    deps,
    { p, agent: a, via: "mcp" },
    { to, kind: "handoff", priority: "high", requires_ack: true, body, refs: [], capsule, task_id: h.task_id, allow_offline: true },
  );

  // Human decision: a handoff with a task reassigns it to the recipient.
  if (t) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(task)
        .set({ assigneeUserId: recipient.userId, assigneeAgentId: null, version: sql`${task.version} + 1`, updatedAt: new Date() })
        .where(and(eq(task.id, t.id), eq(task.version, t.version)))
        .returning({ version: task.version });
      if (!row)
        throw new HubError(
          "E_VERSION_CONFLICT",
          `task ${t.id} changed while handing it over: the message was sent, reassign the task with task_update`,
        );
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "agent",
        actorUserId: p.user.id,
        actorAgentId: a.id,
        via: "mcp",
        action: "task.handed_off",
        subjectId: t.id,
        data: { message: sent.id, version: row?.version },
      });
    });
  }
  return { id: sent.id, thread: sent.threadId, task: t ? { id: t.id, assignee: h.to } : null };
}
