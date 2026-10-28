import type { Role } from "@codetgh/shared";
import { and, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agent, alert, membership, message, personalToken, project, receipt, type TeamSettings, team } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

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
    // Patterns run on every message on the event loop: refuse nested quantifiers like (a+)+ (catastrophic backtracking).
    // shortcut: heuristic check; switch to a linear-time engine (re2) if teams need richer patterns.
    if (pattern.length > 200 || NESTED_QUANTIFIER.test(pattern))
      throw new HubError("E_INVALID", `pattern too long or with nested quantifiers: ${pattern}`);
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
    const [a] = await tx
      .select()
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.teamId, p.teamId)));
    if (!a) throw new HubError("E_NOT_FOUND", "agent not found");
    // Anyone may quarantine their own agents; lifting a quarantine is an admin's call.
    if (a.userId !== p.user.id || trust === "trusted") requireAdmin(p);
    if (a.kind === "a2a" && trust === "trusted") throw new HubError("E_FORBIDDEN", "an external agent stays in quarantine");
    // The whole person: a new session must not be a way out (agents.ts personTrust).
    await tx
      .update(agent)
      .set({ trustLevel: trust })
      .where(and(eq(agent.teamId, p.teamId), eq(agent.userId, a.userId), ne(agent.kind, "a2a")));
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
      .set({ removedAt: new Date(), endedAt: a.endedAt ?? new Date(), acceptRequestsFrom: null })
      .where(eq(agent.id, a.id));
    // An external agent is its token: removing it ends its access to /a2a.
    if (a.kind === "a2a" && a.tokenId) {
      await tx
        .update(personalToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(personalToken.id, a.tokenId), isNull(personalToken.revokedAt)));
      await appendAudit(tx, { ...byUser(p), action: "token.revoked", subjectId: a.tokenId });
    }
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
    await tx.update(agent).set({ acceptRequestsFrom: null }).where(eq(agent.id, a.id));
    await tx
      .update(message)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(message.delegated, true),
          gt(message.expiresAt, new Date()),
          inArray(
            message.id,
            tx
              .select({ id: receipt.messageId })
              .from(receipt)
              .where(and(eq(receipt.recipientAgentId, a.id), isNull(receipt.readAt))),
          ),
        ),
      );
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
    await tx.update(agent).set({ projectId: prj.id, acceptRequestsFrom: null }).where(eq(agent.id, a.id));
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
    await appendAudit(tx, { ...byUser(p), action: "token.revoked", subjectId: t.id });
    return t.userId;
  });
}

export async function changeRole(db: Db, p: Principal, membershipId: string, role: Role) {
  requireAdmin(p);
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.id, membershipId), eq(membership.teamId, p.teamId), eq(membership.status, "active")));
    if (!m) throw new HubError("E_NOT_FOUND", "member not found");
    if ((m.role === "owner" || role === "owner") && p.role !== "owner") throw new HubError("E_FORBIDDEN", "only an owner changes owners");
    if (m.userId === p.user.id) throw new HubError("E_FORBIDDEN", "you cannot change your own role");
    await requireHumanMember(tx, p.teamId, m.userId);
    await tx.update(membership).set({ role }).where(eq(membership.id, m.id));
    await appendAudit(tx, { ...byUser(p), action: "member.role_changed", subjectId: m.id, data: { role } });
  });
}
