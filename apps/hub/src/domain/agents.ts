import type { AgentSessionInput } from "@codetgh/shared";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/index.js";
import { agent, membership, project, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

export type Agent = typeof agent.$inferSelect;
type Via = "mcp" | "rest" | "hook";

export function presence(a: Pick<Agent, "lastSeenAt" | "endedAt">, now = Date.now()) {
  if (a.endedAt) return "offline" as const;
  const age = now - a.lastSeenAt.getTime();
  return age < 90_000 ? ("online" as const) : age < 900_000 ? ("idle" as const) : ("offline" as const);
}

export const oneLine = (s: string, max = 60) => s.replace(/\s+/g, " ").slice(0, max);

// Quarantine follows the person: their token can open new sessions, so any quarantined agent of theirs (removed or
// not) makes every agent of theirs quarantined, until an admin trusts them again.
async function personTrust(db: Db, p: Principal) {
  const [q] = await db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id), eq(agent.trustLevel, "quarantined")))
    .limit(1);
  return q ? ("quarantined" as const) : ("trusted" as const);
}

export async function registerSession(db: Db, p: Principal, input: z.infer<typeof AgentSessionInput>) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  return db.transaction(async (tx) => {
    let projectId: string | null = null;
    // Only repositories someone linked (codetgh project new) are known: anything else stays off the hub entirely.
    if (input.repo_fingerprint) {
      const [row] = await tx
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.teamId, p.teamId), eq(project.repoFingerprint, input.repo_fingerprint)));
      if (!row) return null;
      projectId = row.id;
    }
    const label = oneLine(input.label ?? `${p.handle}@${input.branch ?? input.kind}`);
    const values = {
      kind: input.kind,
      label,
      branch: input.branch ? oneLine(input.branch, 200) : null,
      projectId,
      tokenId: p.tokenId,
      lastSeenAt: new Date(),
      endedAt: null,
      removedAt: null,
      pushMode: input.push_mode ?? null,
      clientVersion: input.client_version ?? null,
      trustLevel: await personTrust(tx, p),
    };
    const [row] = await tx
      .insert(agent)
      .values({ id: newId("agt"), teamId: p.teamId, userId: p.user.id, sessionId: input.session_id, ...values })
      .onConflictDoUpdate({ target: [agent.teamId, agent.userId, agent.sessionId], set: values })
      .returning();
    if (!row) throw new HubError("E_INVALID", "agent registration failed");
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "agent",
      actorUserId: p.user.id,
      actorAgentId: row.id,
      via: "hook",
      action: "agent.session_started",
      subjectId: row.id,
      data: { source: input.source ?? null },
    });
    return row;
  });
}

export async function createProject(db: Db, p: Principal, input: { name: string; repo_fingerprint: string }) {
  if (p.role === "guest") throw new HubError("E_FORBIDDEN", "guests cannot create projects");
  const name = oneLine(input.name, 100);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(project)
      .values({ id: newId("prj"), teamId: p.teamId, name, repoFingerprint: input.repo_fingerprint })
      .onConflictDoUpdate({ target: [project.teamId, project.repoFingerprint], set: { name } })
      .returning({ id: project.id, name: project.name });
    if (!row) throw new HubError("E_INVALID", "project not created");
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "rest",
      action: "project.created",
      subjectId: row.id,
    });
    return row;
  });
}

// codetgh pause / resume: the member's agents stop or resume sending; the person still writes from the console.
export async function setAgentsPaused(db: Db, p: Principal, paused: boolean) {
  await db.transaction(async (tx) => {
    await tx
      .update(membership)
      .set({ agentsPausedAt: paused ? new Date() : null })
      .where(eq(membership.id, p.membershipId));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "rest",
      action: paused ? "agents.paused" : "agents.resumed",
      subjectId: p.membershipId,
    });
  });
  return { agents_paused: paused };
}

export async function endSession(db: Db, p: Principal, sessionId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(agent)
      .set({ endedAt: new Date() })
      .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id), eq(agent.sessionId, sessionId), isNull(agent.endedAt)))
      .returning({ id: agent.id });
    // Intent claims end with the session; exclusive and shared claims run until their TTL.
    if (row) await releaseFor(tx, { agentId: row.id }, "session_end", true);
    if (row)
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "agent",
        actorUserId: p.user.id,
        actorAgentId: row.id,
        via: "hook",
        action: "agent.session_ended",
        subjectId: row.id,
      });
  });
}

export async function agentBySession(db: Db, p: Principal, sessionId: string) {
  const [row] = await db
    .select()
    .from(agent)
    .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id), eq(agent.sessionId, sessionId)));
  return row ?? null;
}

// SPEC « Identité »: the agent argument if it is the caller's, else the token's latest agent, else the user's latest.
export async function resolveAgent(db: Db, p: Principal, agentArg: string | undefined, via: Via): Promise<Agent> {
  const mine = and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id));
  const pick = async (where: ReturnType<typeof and>) =>
    (await db.select().from(agent).where(where).orderBy(desc(agent.lastSeenAt)).limit(1))[0];
  let row = agentArg ? await pick(and(mine, eq(agent.id, agentArg))) : undefined;
  if (agentArg && !row) throw new HubError("E_FORBIDDEN", "this agent does not belong to you");
  row ??= p.tokenId ? await pick(and(mine, eq(agent.tokenId, p.tokenId), isNull(agent.endedAt))) : undefined;
  row ??= await pick(and(mine, isNull(agent.endedAt)));
  if (!row) {
    if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
    const kind = p.auth === "oauth" ? "claude-ai" : "other";
    [row] = await db
      .insert(agent)
      .values({
        id: newId("agt"),
        teamId: p.teamId,
        userId: p.user.id,
        tokenId: p.tokenId,
        sessionId: `auto-${p.tokenId ?? p.auth}`,
        kind,
        label: `${p.handle}@${kind}`,
        trustLevel: await personTrust(db, p),
      })
      .onConflictDoUpdate({ target: [agent.teamId, agent.userId, agent.sessionId], set: { endedAt: null, lastSeenAt: new Date() } })
      .returning();
    if (!row) throw new HubError("E_INVALID", "agent creation failed");
  }
  // Presence: refresh at most every 10 s, not audited (read-path bookkeeping).
  if (Date.now() - row.lastSeenAt.getTime() > 10_000) {
    await db.update(agent).set({ lastSeenAt: new Date() }).where(eq(agent.id, row.id));
    row.lastSeenAt = new Date();
  }
  if (via === "mcp" && row.endedAt) throw new HubError("E_FORBIDDEN", "this agent session has ended");
  return row;
}

export async function setStatus(db: Db, p: Principal, a: Agent, input: { text: string; paths: string[]; ttl_s: number }) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  if (a.trustLevel === "quarantined") throw new HubError("E_FORBIDDEN", "this agent is in quarantine");
  await db.transaction(async (tx) => {
    await tx
      .update(agent)
      .set({ statusText: oneLine(input.text, 200), statusPaths: input.paths, statusExpiresAt: new Date(Date.now() + input.ttl_s * 1000) })
      .where(eq(agent.id, a.id));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "agent",
      actorUserId: p.user.id,
      actorAgentId: a.id,
      via: "mcp",
      action: "agent.status_set",
      subjectId: a.id,
    });
  });
}

export async function listAgents(db: Db, teamId: string, opts: { projectId?: string | null; limit?: number } = {}) {
  const recent = gt(agent.lastSeenAt, new Date(Date.now() - 24 * 3600_000));
  return db
    .select({ agent, name: user.name, handle: membership.handle, project: project.name })
    .from(agent)
    .innerJoin(user, eq(user.id, agent.userId))
    .leftJoin(project, eq(project.id, agent.projectId))
    .innerJoin(membership, and(eq(membership.userId, agent.userId), eq(membership.teamId, agent.teamId), eq(membership.status, "active")))
    .where(
      and(
        eq(agent.teamId, teamId),
        isNull(agent.removedAt),
        or(recent, isNull(agent.endedAt)),
        opts.projectId ? eq(agent.projectId, opts.projectId) : sql`true`,
      ),
    )
    .orderBy(desc(agent.lastSeenAt))
    .limit(opts.limit ?? 50);
}
