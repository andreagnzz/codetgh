import type { AgentSessionInput } from "@codetgh/shared";
import { CreateProjectInput } from "@codetgh/shared/rest";
import { and, arrayContains, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/index.js";
import { agent, membership, project, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Principal } from "../principal.js";
import { isAdmin } from "./admin.js";
import { appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

export type Agent = typeof agent.$inferSelect;
type Via = "mcp" | "rest" | "hook";

// A session is live (online or idle) while seen within this.
export const LIVE_MS = 900_000;

export function presence(a: Pick<Agent, "lastSeenAt" | "endedAt">, now = Date.now()) {
  if (a.endedAt) return "offline" as const;
  const age = now - a.lastSeenAt.getTime();
  return age < 90_000 ? ("online" as const) : age < LIVE_MS ? ("idle" as const) : ("offline" as const);
}

// A turn is believed for this long without a tool call, unless the session is heard from (online): a session killed without
// its Stop hook stays in_turn in the database until the 12 h expiry, and reads as unknown from here on.
const TURN_UNSEEN_MS = 900_000;

export function activityOf(
  a: Pick<Agent, "activity" | "activityAt" | "lastTool" | "lastToolAt" | "lastSeenAt" | "endedAt">,
  now = Date.now(),
) {
  const secs = (d: Date) => Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (!a.activity || !a.activityAt) return { state: "unknown" as const, since_s: null };
  const lastSign = Math.max(a.activityAt.getTime(), a.lastToolAt?.getTime() ?? 0);
  if (a.activity === "in_turn" && presence(a, now) !== "online" && now - lastSign > TURN_UNSEEN_MS)
    return { state: "unknown" as const, since_s: secs(a.activityAt) };
  // The tool belongs to the running turn: one older than the turn's start is the previous turn's.
  const tool =
    a.activity === "in_turn" && a.lastTool && a.lastToolAt && a.lastToolAt >= a.activityAt
      ? { last_tool: a.lastTool, last_tool_age_s: secs(a.lastToolAt) }
      : {};
  return { state: a.activity, since_s: secs(a.activityAt), ...tool };
}

export const oneLine = (s: string, max = 60) => s.replace(/\s+/g, " ").slice(0, max);

// The one rule for a status, in the console and in team_overview: the last status_set until another replaces it, even
// past its ttl, with when it was set (null for one set before the hub kept that).
export const statusOf = (a: Pick<Agent, "statusText" | "statusSetAt">) => (a.statusText ? { text: a.statusText, at: a.statusSetAt } : null);

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

// claude starting or resuming, as codetgh start does; /clear, compaction or a cd re-register the same session.
export const isLaunch = (source?: string) => !source || source === "startup" || source === "resume";

export async function registerSession(db: Db, p: Principal, input: z.infer<typeof AgentSessionInput>) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  return db.transaction(async (tx) => {
    // The session is always the token's own (keyed by its user); the senders are resolved here, never trusted from the body.
    // Refused before the repository is looked at, so the refusal is the same whether or not it is linked.
    const asked = [...new Set(input.accept_requests_from ?? [])];
    if (asked.length && (p.role === "guest" || (await personTrust(tx, p)) === "quarantined"))
      throw new HubError("E_FORBIDDEN", "guests and quarantined members cannot run a delegate session");
    let projectId: string | null = null;
    // An unknown repository stays off the hub, unless the session sends its name to link it and may do so.
    if (input.repo_fingerprint) {
      // A guest sees only their own threads: to them every repository is unknown, so the answer never tells a linked one.
      if (p.role === "guest") return null;
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
    const launched = isLaunch(input.source);
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

// The session path's rules: no guest, quarantined person or kill switch; a new link needs an admin or canAutoLink; only an
// admin renames, so a member's call on a linked repository gets its project unchanged.
export async function createProject(db: Db, p: Principal, input: { name: string; repo_fingerprint: string }) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  if (p.role === "guest") throw new HubError("E_FORBIDDEN", "guests cannot create projects");
  const name = oneLine(input.name, 100);
  return db.transaction(async (tx) => {
    if ((await personTrust(tx, p)) === "quarantined") throw new HubError("E_FORBIDDEN", "quarantined members cannot create projects");
    const columns = { id: project.id, name: project.name };
    const linked = async () =>
      (
        await tx
          .select(columns)
          .from(project)
          .where(and(eq(project.teamId, p.teamId), eq(project.repoFingerprint, input.repo_fingerprint)))
      )[0];
    const audit = (action: string, subjectId: string) =>
      appendAudit(tx, { teamId: p.teamId, actorType: "user", actorUserId: p.user.id, via: "rest", action, subjectId });
    const old = await linked();
    if (old) {
      if (!isAdmin(p) || old.name === name) return old;
      await tx.update(project).set({ name }).where(eq(project.id, old.id));
      await audit("project.renamed", old.id);
      return { id: old.id, name };
    }
    if (!isAdmin(p) && !(await canAutoLink(tx, p)))
      throw new HubError("E_FORBIDDEN", "auto-linking is off for this team: an admin links this repository");
    const [row] = await tx
      .insert(project)
      .values({ id: newId("prj"), teamId: p.teamId, name, repoFingerprint: input.repo_fingerprint })
      .onConflictDoNothing()
      .returning(columns);
    // Linked by another call in the meantime: that project stands.
    if (!row) {
      const won = await linked();
      if (!won) throw new HubError("E_INVALID", "project not created");
      return won;
    }
    await audit("project.created", row.id);
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

// SessionEnd, or a session the hub stopped seeing: the row stays for the audit, it only leaves routing and listings.
async function endAgents(tx: Db, where: SQL | undefined) {
  const rows = await tx
    .update(agent)
    .set({ endedAt: new Date(), acceptRequestsFrom: null })
    .where(and(where, isNull(agent.endedAt)))
    .returning({ id: agent.id, teamId: agent.teamId });
  // Intent claims end with the session; exclusive and shared claims run until their TTL.
  for (const row of rows) await releaseFor(tx, { agentId: row.id }, "session_end", true);
  return rows;
}

export async function endSession(db: Db, p: Principal, sessionId: string) {
  await db.transaction(async (tx) => {
    const [row] = await endAgents(tx, and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id), eq(agent.sessionId, sessionId)));
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

export const STALE_SESSION_MS = 12 * 3_600_000;

// A Claude Code session that sent nothing for 12 h ended without its SessionEnd (crash, closed laptop): end it the same way.
export async function expireStaleSessions(db: Db) {
  await db.transaction(async (tx) => {
    const rows = await endAgents(tx, and(eq(agent.kind, "claude-code"), lt(agent.lastSeenAt, new Date(Date.now() - STALE_SESSION_MS))));
    for (const row of rows)
      await appendAudit(tx, { teamId: row.teamId, actorType: "hub", via: "system", action: "agent.session_expired", subjectId: row.id });
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

// last_tool is a closed vocabulary: Claude Code's built-in tool names (code.claude.com/docs/en/tools-reference; MultiEdit and
// Task are the older names of Edit and Agent), and three words for the rest. A tool's own name is chosen by whoever wrote its
// MCP server, so it never reaches the database or another person's Claude, whatever the client sends.
const BUILT_IN_TOOLS = new Set(
  `Agent Artifact AskUserQuestion Bash CronCreate CronDelete CronList Edit EndConversation EnterPlanMode EnterWorktree ExitPlanMode
  ExitWorktree Glob Grep ListAgents ListMcpResourcesTool LSP Monitor MultiEdit NotebookEdit PowerShell PushNotification Read
  ReadMcpResourceTool RemoteTrigger ReportFindings ScheduleWakeup SendFeedback SendMessage SendUserFile ShareOnboardingGuide Skill
  SubagentHandback Task TaskCreate TaskGet TaskList TaskOutput TaskStop TaskUpdate TodoWrite ToolSearch WaitForMcpServers WebFetch
  WebSearch Workflow Write`.split(/\s+/),
);
const toolClass = (name: string) =>
  BUILT_IN_TOOLS.has(name) ? name : name.startsWith("mcp__plugin_codetgh_") ? "codetgh" : name.startsWith("mcp__") ? "mcp" : "other";

// The hooks' report of a turn, for the caller's own live session only, like touchSession. Not audited: presence-like
// bookkeeping, a state and a tool class. A tool in use means a turn is running, so a wake-up that has no prompt hook still
// reads in_turn; a turn already running keeps its start.
export async function setActivity(db: Db, p: Principal, sessionId: string, report: { activity?: "in_turn" | "idle"; tool?: string }) {
  const mine = and(
    eq(agent.teamId, p.teamId),
    eq(agent.userId, p.user.id),
    eq(agent.sessionId, sessionId),
    isNull(agent.endedAt),
    isNull(agent.removedAt),
  );
  const now = new Date();
  if (report.activity) await db.update(agent).set({ activity: report.activity, activityAt: now }).where(mine);
  if (report.tool) {
    await db
      .update(agent)
      .set({ lastTool: toolClass(report.tool), lastToolAt: now })
      .where(mine);
    await db
      .update(agent)
      .set({ activity: "in_turn", activityAt: now })
      .where(and(mine, or(isNull(agent.activity), ne(agent.activity, "in_turn"))));
  }
}

export async function agentBySession(db: Db, p: Principal, sessionId: string) {
  const [row] = await db
    .select()
    .from(agent)
    .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id), eq(agent.sessionId, sessionId)));
  return row ?? null;
}

// SPEC « Identité »: the agent argument if it is the caller's, else the token's latest agent, else the user's latest,
// else the token's auto agent.
export async function resolveAgent(db: Db, p: Principal, agentArg: string | undefined, via: Via): Promise<Agent> {
  const mine = and(eq(agent.teamId, p.teamId), eq(agent.userId, p.user.id));
  const pick = async (where: ReturnType<typeof and>) =>
    (await db.select().from(agent).where(where).orderBy(desc(agent.lastSeenAt)).limit(1))[0];
  let row = agentArg ? await pick(and(mine, eq(agent.id, agentArg))) : undefined;
  if (agentArg && !row) throw new HubError("E_FORBIDDEN", "this agent does not belong to you");
  const live = and(mine, isNull(agent.endedAt));
  const ofToken = p.tokenId ? and(live, eq(agent.tokenId, p.tokenId)) : undefined;
  // Several live Claude Code sessions: the latest is a guess that files one session's calls under another (and its
  // project). The caller's auto agent takes them instead: no project, and only the console routes to it. OAuth calls
  // (the claude.ai connector) have no token of their own, so they count the person's sessions.
  const several = async (where: ReturnType<typeof and>) =>
    (
      await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(where, eq(agent.kind, "claude-code")))
        .limit(2)
    ).length > 1;
  let guess = !row;
  if (guess && ofToken) {
    if (await several(ofToken)) guess = false;
    else row = await pick(ofToken);
  }
  // Another token's delegate session would let this caller read and ack its authorized requests: name it or get none.
  if (!row && guess && !(await several(live))) row = await pick(and(live, isNull(agent.acceptRequestsFrom)));
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
      .set({
        statusText: oneLine(input.text, 200),
        statusPaths: input.paths,
        statusSetAt: new Date(),
        statusExpiresAt: new Date(Date.now() + input.ttl_s * 1000),
      })
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

// Not STALE_SESSION_MS (12 h): that ends a Claude Code session nobody heard from, this is how long an ended or silent agent stays
// in the lists, so a teammate can still see it went offline. The two answer different questions.
const LISTED_MS = 24 * 3_600_000;

// The agents team_overview lists, and the only ones a sender may address by id: not removed, and not ended for over a day.
export const listed = () => and(isNull(agent.removedAt), or(isNull(agent.endedAt), gt(agent.lastSeenAt, new Date(Date.now() - LISTED_MS))));

// userId and where filter before the limit; total counts the rows the limit cut.
export async function listAgents(
  db: Db,
  teamId: string,
  opts: { projectId?: string | null; userId?: string; where?: SQL; limit?: number } = {},
) {
  return db
    .select({
      agent,
      name: user.name,
      handle: membership.handle,
      project: project.name,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(agent)
    .innerJoin(user, eq(user.id, agent.userId))
    .leftJoin(project, eq(project.id, agent.projectId))
    .innerJoin(membership, and(eq(membership.userId, agent.userId), eq(membership.teamId, agent.teamId), eq(membership.status, "active")))
    .where(
      and(
        eq(agent.teamId, teamId),
        listed(),
        opts.projectId ? eq(agent.projectId, opts.projectId) : sql`true`,
        opts.userId ? eq(agent.userId, opts.userId) : undefined,
        opts.where,
      ),
    )
    .orderBy(desc(agent.lastSeenAt))
    .limit(opts.limit ?? 50);
}

// A delegate does tasks, it never hands them on: A's text would reach C as authorized (confused deputy). The hub cannot
// tell which of a person's sessions made an MCP call (the caller names the agent), so while any live session of theirs
// is a delegate, none of them sends a request.
export async function requireNoDelegate(db: Db, p: Principal) {
  const [live] = await db
    .select({ id: agent.id })
    .from(agent)
    .where(
      and(
        eq(agent.teamId, p.teamId),
        eq(agent.userId, p.user.id),
        isNotNull(agent.acceptRequestsFrom),
        isNull(agent.endedAt),
        isNull(agent.removedAt),
      ),
    )
    .limit(1);
  if (live)
    throw new HubError(
      "E_DELEGATE_CHAIN",
      "a delegate session of yours is live, so none of your sessions sends requests until it ends (or you turn it off in the console): reply to your requester, or ask a question instead",
    );
}

// The live delegate session of `handle` on the sender's project that accepts this sender's requests.
export async function delegateFor(db: Db, p: Principal, from: Agent, handle: string) {
  await requireNoDelegate(db, p);
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
