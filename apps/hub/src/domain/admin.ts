import type { Role } from "@codetgh/shared";
import { and, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agent, alert, invitation, membership, personalToken, project, type TeamSettings, team } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { expireDelegated, lockDelegates } from "./agents.js";
import { type AuditInput, appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

// A group repeated by +, * or {…} that holds a quantifier or an alternation, at any depth: (a+)+, ((a+))+ and (a|aa)+
// backtrack exponentially. A scan, so no nesting hides one; escapes and character classes are literal text.
function repeatsAmbiguousGroup(pattern: string) {
  const open: boolean[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "\\") i++;
    else if (c === "[") {
      // A class ends at the first ] not escaped.
      for (i++; i < pattern.length && pattern[i] !== "]"; i++) if (pattern[i] === "\\") i++;
    } else if (c === "(") open.push(false);
    else if (c === ")") {
      const ambiguous = open.pop();
      if (ambiguous && /[+*{]/.test(pattern[i + 1] ?? "")) return true;
      if (ambiguous && open.length) open[open.length - 1] = true;
    } else if ("+*{|".includes(c) || (c === "?" && pattern[i - 1] !== "(")) {
      if (open.length) open[open.length - 1] = true;
    }
  }
  return false;
}

// Handles are addresses (@handle): lowercase letters, digits and dashes; bridge- and a2a- belong to the hub's own members.
export const RESERVED_HANDLE = /^(bridge|a2a)-/;

// The hub's own members are known by their agent's kind (an external A2A agent, a bridge), not by a handle.
const hasAgentOfKind = async (db: Db, teamId: string, userId: string, kinds: string[]) => {
  const [row] = await db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.teamId, teamId), eq(agent.userId, userId), inArray(agent.kind, kinds)))
    .limit(1);
  return Boolean(row);
};

export async function requireHumanMember(db: Db, teamId: string, userId: string) {
  if (await hasAgentOfKind(db, teamId, userId, ["a2a", "bridge"]))
    throw new HubError("E_FORBIDDEN", "a system member (a2a-, bridge-) keeps its handle and role");
}

// An a2a member stays revocable: that is how an admin cuts an external agent whose token leaked.
export async function requireNotBridge(db: Db, teamId: string, userId: string) {
  if (await hasAgentOfKind(db, teamId, userId, ["bridge"]))
    throw new HubError("E_FORBIDDEN", "the GitHub or Slack bridge member cannot be revoked: its webhook would stop working");
}

// A pending invitation ends with the admin rights or the token that made it: a cut-off access must not return through a link.
export async function endPendingInvitations(
  db: Db,
  by: Pick<AuditInput, "teamId" | "actorType" | "actorUserId" | "via">,
  ...madeBy: SQL[]
) {
  const rows = await db
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitation.teamId, by.teamId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), ...madeBy))
    .returning({ id: invitation.id });
  for (const r of rows) await appendAudit(db, { ...by, action: "invitation.revoked", subjectId: r.id });
}

// Owner changes take the owners lock, as eraseMe does, and read the actor's role again under it: two owners demoting or
// revoking each other at once cannot both pass on the role their requests started with and leave the team with no owner.
export async function requireOwnerNow(tx: Db, teamId: string, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owners:${teamId}`}, 0))`);
  const [me] = await tx
    .select({ role: membership.role })
    .from(membership)
    .where(and(eq(membership.teamId, teamId), eq(membership.userId, userId), eq(membership.status, "active")));
  if (me?.role !== "owner") throw new HubError("E_FORBIDDEN", "you are no longer an owner of this team");
}

export const isAdmin = (p: Principal) => p.role === "owner" || p.role === "admin";

export function requireAdmin(p: Principal) {
  if (!isAdmin(p)) throw new HubError("E_FORBIDDEN", "admins only");
}

// A guest reads only the threads they take part in: no tasks, memory, claims or team view.
export function requireMember(p: Principal) {
  if (p.role === "guest") throw new HubError("E_FORBIDDEN", "guests see only their own threads");
}

export const byUser = (p: Principal) => ({ teamId: p.teamId, actorType: "user" as const, actorUserId: p.user.id, via: "console" as const });

export async function setKillSwitch(db: Db, p: Principal, reason: string) {
  requireAdmin(p);
  if (!reason.trim()) throw new HubError("E_INVALID", "a reason is required");
  await db.transaction(async (tx) => {
    await tx
      .update(team)
      .set({ killSwitchAt: new Date(), killSwitchReason: reason.slice(0, 500), killSwitchBy: p.user.id })
      .where(eq(team.id, p.teamId));
    await appendAudit(tx, { ...byUser(p), action: "kill_switch.on", subjectId: p.teamId });
  });
}

export async function resumeKillSwitch(db: Db, p: Principal, confirm: string) {
  requireAdmin(p);
  if (confirm !== "yes") throw new HubError("E_INVALID", "confirm with yes");
  await db.transaction(async (tx) => {
    await tx.update(team).set({ killSwitchAt: null, killSwitchReason: null, killSwitchBy: null }).where(eq(team.id, p.teamId));
    await appendAudit(tx, { ...byUser(p), action: "kill_switch.off", subjectId: p.teamId });
  });
}

export async function updateSettings(
  db: Db,
  p: Principal,
  input: {
    retentionDays?: number;
    secretPatterns: string[];
    claimsEnforcement?: TeamSettings["claims_enforcement"];
    memoryAcceptBy?: TeamSettings["memory_accept_by"];
    memoryAcceptViaMcp?: boolean;
    autoLinkProjects?: boolean;
    pushAllowedModes?: TeamSettings["push_allowed_modes"];
    slackChannel?: string;
    loopOrchestrator?: string;
  },
) {
  requireAdmin(p);
  if (input.loopOrchestrator) {
    const [m] = await db
      .select({ role: membership.role })
      .from(membership)
      .where(and(eq(membership.teamId, p.teamId), eq(membership.handle, input.loopOrchestrator), eq(membership.status, "active")));
    if (!m || m.role === "guest") throw new HubError("E_INVALID", `no active member @${input.loopOrchestrator} to orchestrate loops`);
  }
  for (const pattern of input.secretPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new HubError("E_INVALID", `invalid pattern: ${pattern}`);
    }
    // Patterns run on every message on the event loop: refuse the forms that backtrack exponentially.
    // shortcut: heuristic check, blind to polynomial chains like .*.*.*; switch to a linear-time engine (re2) if teams need richer patterns.
    if (pattern.length > 200 || repeatsAmbiguousGroup(pattern))
      throw new HubError("E_INVALID", `pattern too long, or with a repeated group holding a quantifier or |: ${pattern}`);
  }
  await db.transaction(async (tx) => {
    // The Slack bot is shared by the hub: one team's admin must not aim its posts at another team's channel.
    if (input.slackChannel) {
      const [taken] = await tx
        .select({ id: team.id })
        .from(team)
        .where(and(ne(team.id, p.teamId), sql`${team.settings}->>'slack_channel' = ${input.slackChannel}`));
      if (taken) throw new HubError("E_INVALID", "this Slack channel is used by another team");
    }
    // Re-read under a row lock: an alert or GitHub write since this request loaded the principal must survive.
    const [current] = await tx.select({ settings: team.settings }).from(team).where(eq(team.id, p.teamId)).for("update");
    const was = current?.settings ?? {};
    const settings: TeamSettings = {
      ...was,
      retention_days: input.retentionDays === undefined ? was.retention_days : Math.min(Math.max(input.retentionDays, 1), 3650),
      secret_patterns: input.secretPatterns.slice(0, 50),
      claims_enforcement: input.claimsEnforcement ?? was.claims_enforcement,
      memory_accept_by: input.memoryAcceptBy ?? was.memory_accept_by,
      memory_accept_via_mcp: input.memoryAcceptViaMcp ?? was.memory_accept_via_mcp,
      auto_link_projects: input.autoLinkProjects ?? was.auto_link_projects,
      push_allowed_modes: input.pushAllowedModes ?? was.push_allowed_modes,
      slack_channel: input.slackChannel,
      loop_orchestrator: input.loopOrchestrator,
    };
    await tx.update(team).set({ settings }).where(eq(team.id, p.teamId));
    await appendAudit(tx, {
      ...byUser(p),
      action: "settings.updated",
      subjectId: p.teamId,
      data: { patterns: settings.secret_patterns?.length },
    });
  });
}

export async function resolveAlert(db: Db, p: Principal, alertId: string, status: "dismissed" | "false_positive" | "fingerprint_allowed") {
  requireAdmin(p);
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(alert)
      .where(and(eq(alert.id, alertId), eq(alert.teamId, p.teamId)));
    if (!a) throw new HubError("E_NOT_FOUND", "alert not found");
    if (status === "fingerprint_allowed") {
      const fingerprints = (a.detail.fingerprints as string[] | undefined) ?? [];
      if (!fingerprints.length) throw new HubError("E_INVALID", "this alert has no fingerprint");
      const [current] = await tx.select({ settings: team.settings }).from(team).where(eq(team.id, p.teamId)).for("update");
      const allowed = [...new Set([...(current?.settings.allowed_fingerprints ?? []), ...fingerprints])];
      await tx
        .update(team)
        .set({ settings: { ...current?.settings, allowed_fingerprints: allowed } })
        .where(eq(team.id, p.teamId));
    }
    await tx.update(alert).set({ status, resolvedBy: p.user.id, resolvedAt: new Date() }).where(eq(alert.id, a.id));
    await appendAudit(tx, { ...byUser(p), action: `alert.${status}`, subjectId: a.id });
  });
}

export async function setAgentTrust(db: Db, p: Principal, agentId: string, trust: "trusted" | "quarantined") {
  await db.transaction(async (tx) => {
    await lockDelegates(tx, p.teamId);
    const [a] = await tx
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.teamId, p.teamId)));
    if (!a) throw new HubError("E_NOT_FOUND", "agent not found");
    // Anyone may quarantine their own agents; lifting a quarantine is an admin's call.
    if (a.userId !== p.user.id || trust === "trusted") requireAdmin(p);
    if (a.kind === "a2a" && trust === "trusted") throw new HubError("E_FORBIDDEN", "an external agent stays in quarantine");
    // The whole person: a new session must not be a way out (agents.ts personTrust). Nor a delegate session already live.
    const rows = await tx
      .update(agent)
      .set({ trustLevel: trust, ...(trust === "quarantined" && { acceptRequestsFrom: null, delegateSince: null }) })
      .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, a.userId), ne(agent.kind, "a2a")))
      .returning({ id: agent.id, userId: agent.userId });
    if (trust === "quarantined") await expireDelegated(tx, rows);
    await appendAudit(tx, { ...byUser(p), action: `agent.${trust}`, subjectId: a.id });
  });
}

// The row stays (messages and the audit chain point to it): the session ends and leaves every list.
export async function removeAgent(db: Db, p: Principal, agentId: string) {
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.teamId, p.teamId), isNull(agent.removedAt)));
    if (!a) throw new HubError("E_NOT_FOUND", "agent not found");
    if (a.userId !== p.user.id) requireAdmin(p);
    await tx
      .update(agent)
      .set({ removedAt: new Date(), endedAt: a.endedAt ?? new Date(), acceptRequestsFrom: null, delegateSince: null })
      .where(eq(agent.id, a.id));
    // An external agent is its token: removing it ends its access to /a2a.
    if (a.kind === "a2a" && a.tokenId) {
      await tx
        .update(personalToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(personalToken.id, a.tokenId), isNull(personalToken.revokedAt)));
      await appendAudit(tx, { ...byUser(p), action: "token.revoked", subjectId: a.tokenId });
    }
    await expireDelegated(tx, [a]);
    await releaseFor(tx, { agentId: a.id }, "session_end", true);
    await appendAudit(tx, { ...byUser(p), action: "agent.removed", subjectId: a.id });
  });
}

// Console « Couper »: the session stops accepting requests, and the ones it has not done yet expire now.
export async function stopDelegate(db: Db, p: Principal, agentId: string) {
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.teamId, p.teamId), isNotNull(agent.acceptRequestsFrom)));
    if (!a) throw new HubError("E_NOT_FOUND", "no delegate session");
    if (a.userId !== p.user.id) requireAdmin(p);
    await tx.update(agent).set({ acceptRequestsFrom: null, delegateSince: null }).where(eq(agent.id, a.id));
    await expireDelegated(tx, [a]);
    await appendAudit(tx, { ...byUser(p), action: "agent.delegate_stopped", subjectId: a.id });
  });
}

// System agents (bridge, a2a) and the token's REST agent (cli-…, the CLI and the presence mod) are not sessions to place.
export const isSessionAgent = (a: { kind: string; sessionId: string }) =>
  a.kind !== "bridge" && a.kind !== "a2a" && !a.sessionId.startsWith("cli-");

export async function setAgentProject(db: Db, p: Principal, agentId: string, projectId: string) {
  requireMember(p);
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.teamId, p.teamId), isNull(agent.removedAt)));
    if (!a) throw new HubError("E_NOT_FOUND", "agent not found");
    if (a.userId !== p.user.id) requireAdmin(p);
    if (!isSessionAgent(a)) throw new HubError("E_FORBIDDEN", "only Claude Code sessions can be attached to a project");
    const [prj] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, p.teamId)));
    if (!prj) throw new HubError("E_NOT_FOUND", "project not found");
    // Delegate mode was granted for one project: moving the session ends it.
    await tx.update(agent).set({ projectId: prj.id, acceptRequestsFrom: null, delegateSince: null }).where(eq(agent.id, a.id));
    await expireDelegated(tx, [a]);
    await appendAudit(tx, { ...byUser(p), action: "agent.project_set", subjectId: a.id, data: { project_id: prj.id } });
  });
}

export async function revokeToken(db: Db, p: Principal, tokenId: string) {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(personalToken)
      .where(and(eq(personalToken.id, tokenId), eq(personalToken.teamId, p.teamId), isNull(personalToken.revokedAt)));
    if (!t) throw new HubError("E_NOT_FOUND", "token not found");
    if (t.userId !== p.user.id) requireAdmin(p);
    await tx.update(personalToken).set({ revokedAt: new Date() }).where(eq(personalToken.id, t.id));
    await endPendingInvitations(tx, byUser(p), eq(invitation.invitedByToken, t.id));
    await appendAudit(tx, { ...byUser(p), action: "token.revoked", subjectId: t.id });
    return t.userId;
  });
}

export async function changeRole(db: Db, p: Principal, membershipId: string, role: Role) {
  requireAdmin(p);
  return db.transaction(async (tx) => {
    await lockDelegates(tx, p.teamId);
    const [m] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.id, membershipId), eq(membership.teamId, p.teamId), eq(membership.status, "active")));
    if (!m) throw new HubError("E_NOT_FOUND", "member not found");
    if (m.role === "owner" || role === "owner") {
      if (p.role !== "owner") throw new HubError("E_FORBIDDEN", "only an owner changes owners");
      await requireOwnerNow(tx, p.teamId, p.user.id);
    }
    if (m.userId === p.user.id) throw new HubError("E_FORBIDDEN", "you cannot change your own role");
    await requireHumanMember(tx, p.teamId, m.userId);
    await tx.update(membership).set({ role }).where(eq(membership.id, m.id));
    if (role === "member" || role === "guest") await endPendingInvitations(tx, byUser(p), eq(invitation.invitedBy, m.userId));
    else if (m.role === "owner" && role === "admin")
      await endPendingInvitations(tx, byUser(p), eq(invitation.invitedBy, m.userId), eq(invitation.role, "owner"));
    // A guest runs no delegate session (agents.ts registerSession), so a live one stops accepting requests.
    if (role === "guest") {
      const rows = await tx
        .update(agent)
        .set({ acceptRequestsFrom: null, delegateSince: null })
        .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, m.userId), isNotNull(agent.acceptRequestsFrom)))
        .returning({ id: agent.id, userId: agent.userId });
      await expireDelegated(tx, rows);
    }
    await appendAudit(tx, { ...byUser(p), action: "member.role_changed", subjectId: m.id, data: { role } });
    return m.userId;
  });
}
