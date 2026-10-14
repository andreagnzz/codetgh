import { escapeAttr } from "@codetgh/guard";
import { and, count, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { message, project, receipt, user } from "../db/schema.js";
import type { Principal } from "../principal.js";
import { type Agent, listAgents, presence } from "./agents.js";
import { liveClaims } from "./claims.js";
import { packetDecisions } from "./memory.js";
import { myOpenTasks } from "./tasks.js";

const MAX_CONTEXT_CHARS = 4800; // ≈ 1 200 tokens

// Free fields written by peers (label, branch, status) are one line, 60 characters, escaped.
const free = (s: string | null | undefined) => (s ? escapeAttr(s, 60) : "");

function ago(d: Date) {
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

// Unread handoffs for the packet: who, which message, task and branch. Never the capsule text.
async function pendingHandoffs(db: Db, p: Principal, agentId: string) {
  const rows = await db
    .select({ id: message.id, from: user.name, task: message.taskId, capsule: message.capsule })
    .from(receipt)
    .innerJoin(message, eq(message.id, receipt.messageId))
    .innerJoin(user, eq(user.id, message.fromUserId))
    .where(
      and(
        eq(receipt.recipientUserId, p.user.id),
        or(isNull(receipt.recipientAgentId), eq(receipt.recipientAgentId, agentId)),
        isNull(receipt.readAt),
        eq(message.kind, "handoff"),
      ),
    )
    .limit(3);
  return rows.map((r) => ({
    id: r.id,
    from: r.from,
    task: r.task,
    branch: typeof r.capsule?.branch === "string" ? r.capsule.branch : null,
  }));
}

async function unreadSummary(db: Db, p: Principal, agentId: string) {
  const visible = and(
    eq(receipt.recipientUserId, p.user.id),
    eq(receipt.teamId, p.teamId),
    or(isNull(receipt.recipientAgentId), eq(receipt.recipientAgentId, agentId)),
    isNull(receipt.readAt),
    or(isNull(message.expiresAt), gt(message.expiresAt, new Date())),
  );
  const byKind = await db
    .select({ kind: message.kind, n: count() })
    .from(receipt)
    .innerJoin(message, eq(message.id, receipt.messageId))
    .where(visible)
    .groupBy(message.kind);
  const blocking = await db
    .select({ id: message.id })
    .from(receipt)
    .innerJoin(message, eq(message.id, receipt.messageId))
    .where(and(visible, eq(message.priority, "blocking")))
    .limit(5);
  return { byKind: Object.fromEntries(byKind.map((r) => [r.kind, r.n])) as Record<string, number>, blocking: blocking.map((b) => b.id) };
}

export async function teamOverview(db: Db, p: Principal, me: Agent, opts: { scope: "team" | "project"; limit: number }) {
  const agents = await listAgents(db, p.teamId, { projectId: opts.scope === "project" ? me.projectId : undefined, limit: opts.limit });
  const unread = await unreadSummary(db, p, me.id);
  return {
    team: free(p.teamName),
    you: { handle: p.handle, agent: me.id },
    paused: p.paused,
    agents_paused: p.agentsPaused,
    agents: agents
      .filter((r) => r.agent.id !== me.id)
      .map((r) => ({
        id: r.agent.id,
        handle: r.handle,
        name: free(r.name),
        label: free(r.agent.label),
        project: free(r.project),
        branch: free(r.agent.branch),
        presence: presence(r.agent),
        status: r.agent.statusExpiresAt && r.agent.statusExpiresAt > new Date() ? free(r.agent.statusText) : "",
        last_seen: r.agent.lastSeenAt.toISOString(),
      })),
    claims: await liveClaims(db, p, me, opts),
    unread: unread.byKind,
    blocking_message_ids: unread.blocking,
  };
}

// SessionStart packet: hub data only; a peer's words are replaced by message ids and read later in an envelope.
export async function contextPacket(db: Db, p: Principal, me: Agent | null) {
  const [prj] = me?.projectId ? await db.select({ name: project.name }).from(project).where(eq(project.id, me.projectId)) : [];
  const attrs = `team="${free(p.teamName)}" project="${free(prj?.name)}" agent="${me?.id ?? ""}" you="${free(p.user.name)}"`;
  if (p.paused || !me) return `<codetgh_context ${attrs}>CodeTgh is paused by an admin: work normally without it.</codetgh_context>`;
  const ov = await teamOverview(db, p, me, { scope: "team", limit: 30 });
  const tasks = await myOpenTasks(db, p);
  const handoffs = await pendingHandoffs(db, p, me.id);
  const decisions = await packetDecisions(db, p);
  const people = ov.agents
    .filter((a) => a.presence !== "offline")
    .slice(0, 10)
    .map(
      (a) =>
        `${a.name} (@${a.handle}${a.branch ? `, ${a.branch}` : ""}, ${a.presence}${a.status ? `, "${a.status}"` : ""}, ${ago(new Date(a.last_seen))})`,
    );
  // Others' claims only, without their reasons (peer text stays out of the packet).
  const claims = ov.claims.filter((c) => !c.mine).slice(0, 8);
  const kinds = Object.entries(ov.unread);
  const total = kinds.reduce((s, [, n]) => s + n, 0);
  const lines = [
    ...(handoffs.length
      ? [
          `Pending handoffs: ${handoffs
            .map((h) => `from ${free(h.from)} (${h.id}${h.task ? `, task ${h.task}` : ""}${h.branch ? `, branch ${free(h.branch)}` : ""})`)
            .join("; ")}; the full context arrives with your next prompt`,
        ]
      : []),
    `Online: ${people.length ? people.join("; ") : "nobody else"}`,
    ...(claims.length ? [`Claims: ${claims.map((c) => `${c.scope} → ${c.holder} (${c.mode}, ${c.minutes_left} min)`).join("; ")}`] : []),
    `Unread: ${total}${total ? ` (${kinds.map(([k, n]) => `${n} ${k}`).join(", ")})` : ""}${total ? ", read them with inbox_read" : ""}`,
    ...(ov.blocking_message_ids.length ? [`Blocking requests: ${ov.blocking_message_ids.join(", ")}`] : []),
    ...(decisions.length ? [`Team decisions: ${decisions.join("; ")}`] : []),
    ...(tasks.length ? [`Your tasks: ${tasks.map((t) => `${t.id} (${t.status}) ${free(t.title)}`).join("; ")}`] : []),
    "Tools: ask_peer, send_message, inbox_read, ack, team_overview, status_set, claim_check, task_list, memory_search. Rules: skill codetgh.",
  ];
  let body = lines.join("\n");
  if (body.length > MAX_CONTEXT_CHARS - attrs.length - 40) body = `${body.slice(0, MAX_CONTEXT_CHARS - attrs.length - 60)}\n[…]`;
  return `<codetgh_context ${attrs}>\n${body}\n</codetgh_context>`;
}
