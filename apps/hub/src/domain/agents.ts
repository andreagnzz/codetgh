import type { AgentSessionInput } from "@codetgh/shared";
import { CreateProjectInput } from "@codetgh/shared/rest";
import { and, arrayContains, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
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

// Members link a new repository by starting a session in it; never a guest, a quarantined person, or once an admin
// turned auto_link_projects off.
export async function canAutoLink(db: Db, p: Principal) {
  return p.role !== "guest" && p.settings.auto_link_projects !== false && (await personTrust(db, p)) === "trusted";
}

export async function registerSession(db: Db, p: Principal, input: z.infer<typeof AgentSessionInput>) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  return db.transaction(async (tx) => {
    let projectId: string | null = null;
    // An unknown repository stays off the hub, unless the session sends its name to link it and may do so.
    if (input.repo_fingerprint) {
      const [row] = await tx
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.teamId, p.teamId), eq(project.repoFingerprint, input.repo_fingerprint)));
      const link = CreateProjectInput.safeParse({ name: input.repo_name, repo_fingerprint: input.repo_fingerprint });
      if (row) projectId = row.id;
      else if (link.success && (await canAutoLink(tx, p))) projectId = (await createProject(tx, p, link.data)).id;
      else return null;
    }
    const label = oneLine(input.label ?? `${p.handle}@${input.branch ?? input.kind}`);
    // The session is always the token's own (keyed by its user); the senders are resolved here, never trusted from the body.
    const asked = [...new Set(input.accept_requests_from ?? [])];
    if (asked.length && (p.role === "guest" || (await personTrust(tx, p)) === "quarantined"))
      throw new HubError("E_FORBIDDEN", "guests and quarantined members cannot run a delegate session");
    const accept = asked.length
      ? await tx
          .select({ userId: membership.userId })
          .from(membership)
          .where(
            and(
              eq(membership.teamId, p.teamId),
              eq(membership.status, "active"),
              ne(membership.role, "guest"),
              ne(membership.userId, p.user.id),
              inArray(
                membership.handle,
                asked.map((h) => h.slice(1)),
              ),
            ),
          )
      : [];
    // Refused, not dropped: a delegate opt-in must say exactly whom it trusts.
    if (accept.length !== asked.length)
      throw new HubError("E_INVALID", "--accept-requests-from takes active members of your team other than you, not guests");
    // claude starting or resuming, as codetgh start does; /clear, compaction or a cd re-register the same session.
    const launched = !input.source || input.source === "startup" || input.source === "resume";
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
      // SessionStart input may not carry the mode (resume, compact): keep the last one reported.
      ...(input.permission_mode && { permissionMode: input.permission_mode }),
      clientVersion: input.client_version ?? null,
      platform: input.platform ?? null,
      trustLevel: await personTrust(tx, p),
      // Fails closed: a registration without the opt-in (or with no valid sender) clears it. Only a launch grants it.
      acceptRequestsFrom: accept.length && launched ? accept.map((m) => m.userId) : null,
    };
    // Outside a repository, a resume keeps the project the session was attached to in the console.
    const { projectId: _, ...kept } = values;
    // Re-registering with the opt-in keeps the current value, so a « Couper » holds, but only on the same project:
    // the grant was for one project, and a cd into another repository ends it.
    const keep = accept.length &&
      !launched && {
        acceptRequestsFrom: sql`case when ${agent.projectId} is not distinct from ${input.repo_fingerprint ? projectId : agent.projectId} then ${agent.acceptRequestsFrom} else null end`,
      };
    const [row] = await tx
      .insert(agent)
      .values({ id: newId("agt"), teamId: p.teamId, userId: p.user.id, sessionId: input.session_id, ...values })
      .onConflictDoUpdate({
        target: [agent.teamId, agent.userId, agent.sessionId],
        set: { ...(input.repo_fingerprint ? values : kept), ...keep },
      })
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
      data: { source: input.source ?? null, ...(row.acceptRequestsFrom && { delegate_senders: row.acceptRequestsFrom.length }) },
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
      .set({ endedAt: new Date(), acceptRequestsFrom: null })
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

// shortcut: not audited, like presence; the prompt hook only sends it when it changed.
export async function setPermissionMode(db: Db, agentId: string, mode: string) {
  await db.update(agent).set({ permissionMode: mode }).where(eq(agent.id, agentId));
}

type Usage = { five_hour?: number; five_hour_reset?: number; seven_day?: number; seven_day_reset?: number };
const at = (s?: number) => (s === undefined ? null : new Date(s * 1000));

// The presence mod's poll: keeps the caller's own open session online while it idles at the prompt. Never creates one.
// Only a live session of the caller's stores the usage it reports; a window it no longer reads is cleared.
export async function touchSession(db: Db, p: Principal, sessionId: string, usage: Usage = {}) {
  const rows = await db
    .update(agent)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(agent.teamId, p.teamId),
        eq(agent.userId, p.user.id),
        eq(agent.sessionId, sessionId),
        isNull(agent.endedAt),
        isNull(agent.removedAt),
      ),
    )
    .returning({ id: agent.id });
  if (rows.length && Object.values(usage).some((v) => v !== undefined))
    await db
      .update(membership)
      .set({
        usageFiveHour: usage.five_hour ?? null,
        usageFiveHourReset: at(usage.five_hour_reset),
        usageSevenDay: usage.seven_day ?? null,
        usageSevenDayReset: at(usage.seven_day_reset),
      })
      .where(eq(membership.id, p.membershipId));
  return rows.length > 0;
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

export async function setStatus(db: Db, p: Principal, a: Agent, input: { text: string; paths: string[]; ttl_s: number }, via: Via = "mcp") {
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
      via,
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

// The live delegate session of `handle` on the sender's project that accepts this sender's requests.
export async function delegateFor(db: Db, p: Principal, from: Agent, handle: string) {
  // A delegate does tasks, it never hands them on: A's text would reach C as authorized (confused deputy).
  if (from.acceptRequestsFrom)
    throw new HubError("E_DELEGATE_CHAIN", "a delegate session cannot send requests: reply to your requester, or ask a question instead");
  const [row] = from.projectId
    ? await db
        .select({ id: agent.id })
        .from(agent)
        .innerJoin(membership, and(eq(membership.userId, agent.userId), eq(membership.teamId, agent.teamId)))
        .where(
          and(
            eq(agent.teamId, p.teamId),
            eq(membership.handle, handle.replace(/^@/, "")),
            eq(membership.status, "active"),
            eq(agent.projectId, from.projectId),
            arrayContains(agent.acceptRequestsFrom, [p.user.id]),
            isNull(agent.endedAt),
            isNull(agent.removedAt),
            gt(agent.lastSeenAt, new Date(Date.now() - 900_000)),
          ),
        )
        .orderBy(desc(agent.lastSeenAt))
        .limit(1)
    : [];
  if (!row)
    throw new HubError(
      "E_NO_DELEGATE",
      `${handle} has no live session on this project that accepts your requests (codetgh start --accept-requests-from @${p.handle}): ask a question instead`,
    );
  return row.id;
}

// Console « Délégations »: the delegate sessions a person may turn off (their own; an admin, the team's).
export async function listDelegates(db: Db, p: Principal, admin: boolean) {
  const rows = await db
    .select({ agent, name: user.name, project: project.name })
    .from(agent)
    .innerJoin(user, eq(user.id, agent.userId))
    .leftJoin(project, eq(project.id, agent.projectId))
    .where(
      and(
        eq(agent.teamId, p.teamId),
        isNotNull(agent.acceptRequestsFrom),
        isNull(agent.endedAt),
        isNull(agent.removedAt),
        admin ? undefined : eq(agent.userId, p.user.id),
      ),
    )
    .orderBy(desc(agent.lastSeenAt));
  const ids = [...new Set(rows.flatMap((r) => r.agent.acceptRequestsFrom ?? []))];
  const senders = !ids.length
    ? []
    : await db
        .select({ userId: membership.userId, handle: membership.handle })
        .from(membership)
        .where(and(eq(membership.teamId, p.teamId), inArray(membership.userId, ids)));
  const handleOf = new Map(senders.map((s) => [s.userId, `@${s.handle}`]));
  return rows.map((r) => ({ ...r, senders: (r.agent.acceptRequestsFrom ?? []).map((id) => handleOf.get(id) ?? "?") }));
}
