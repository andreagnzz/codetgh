import { escapeAttr, renderPeerMessage, textFlags } from "@codetgh/guard";
import type { ClaimMode } from "@codetgh/shared";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import picomatch from "picomatch";
import type { Db } from "../db/index.js";
import { claim, membership, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Principal } from "../principal.js";
import { requireMember } from "./admin.js";
import type { Agent } from "./agents.js";
import { appendAudit } from "./audit.js";
import { assertNoSecrets, type MessagingDeps, sendMessage } from "./messages.js";

const MAX_LIVE_CLAIMS = 100;

type Claim = typeof claim.$inferSelect;
type ScopeType = Claim["scopeType"];
type Holder = Claim & { name: string; handle: string };

const INTENT_TTL_S = 600;

// SPEC « Réservations »: requested mode (row) against held mode (column).
export function compat(requested: ClaimMode, held: ClaimMode): "conflict" | "warn" | "notify" | "ok" {
  if (requested === "shared") return "ok";
  return held === "exclusive" ? "conflict" : held === "intent" ? "warn" : "notify";
}

// Never claimed, never shared: secrets and git internals.
const EXCLUDED = picomatch(["**/.env*", "**/*.pem", "**/*.key", ".git/**", "**/.git/**"], { dot: true });
export const isExcluded = (path: string) => EXCLUDED(path);

function scopeType(scope: string): ScopeType {
  if (scope.startsWith("task:")) return "task";
  if (scope.startsWith("resource:")) return "resource";
  return picomatch.scan(scope).isGlob ? "glob" : "path";
}

// picomatch reads a leading ! as "every path but this": a negated glob reaches every file of the project but a few.
const negated = (scope: string) => picomatch.scan(scope).negated;

// A glob with no directory in front of ** (or a bare *) reaches every file of the project.
const coversProject = (scope: string) => {
  const glob = scope.replace(/^\.\//, "");
  return glob === "*" || (picomatch.scan(glob).base === "" && glob.includes("**"));
};

// picomatch turns a glob into a backtracking regex that runs on the hub's event loop, in every teammate's edit hook, once
// per live claim. Measured with picomatch 4.0.7 on a 300-char path of "a": with 2 runs of stars the worst accepted
// scope takes 4 ms whatever the braces, with 3 it takes 80 to 340 ms, with 4 seconds. Braces multiply that, so a group
// and each comma weigh 1 together (6 at most), and braces never nest. The parentheses and | of extglobs (@(a|a) is
// exponential) are refused here too: PATH_CHARS (packages/shared) keeps them out of new scopes, and this keeps them out
// of the matcher for a scope stored by other means. Re-measure (apps/hub/test/claims-glob.test.ts) before widening any of it.
export const globTooComplex = (scope: string) =>
  (scope.match(/\*+/g)?.length ?? 0) > 2 || (scope.match(/[{,]/g)?.length ?? 0) > 6 || /\{[^}]*\{|[()|]/.test(scope);

const matchers = new Map<string, ((path: string) => boolean) | null>();
// A stored scope over the limits or negated (claimed before they existed, or written straight to the table) matches nothing: it
// blocks nobody, which is the safe side for a claim that is advisory (the permission prompt stays), whereas matching
// it could stall every teammate, and reading it as a prefix would block the whole project. It ends with its ttl.
function matcher(scope: string) {
  let m = matchers.get(scope);
  if (m === undefined) {
    m = globTooComplex(scope) || negated(scope) ? null : picomatch(scope, { dot: true });
    if (matchers.size >= 500) matchers.clear();
    matchers.set(scope, m);
  }
  return m;
}

export function covers(c: Pick<Claim, "scopeType" | "scope">, path: string) {
  if (c.scopeType === "path") return c.scope === path;
  return c.scopeType === "glob" && (matcher(c.scope)?.(path) ?? false);
}

function overlaps(a: { scopeType: ScopeType; scope: string }, b: Pick<Claim, "scopeType" | "scope">) {
  if (a.scopeType === "task" || a.scopeType === "resource" || b.scopeType === "task" || b.scopeType === "resource")
    return a.scope === b.scope;
  if (a.scopeType === "path") return covers(b, a.scope);
  if (b.scopeType === "path") return covers(a, b.scope);
  // shortcut: glob against glob compares the static bases only, folder by folder (packages/ui is not under
  // packages/ui-kit); exact overlap needs a glob intersection algorithm. An empty base is under everything.
  const [x, y] = [picomatch.scan(a.scope).base, picomatch.scan(b.scope).base];
  const under = (s: string, base: string) => base === "" || s === base || s.startsWith(`${base}/`);
  return under(x, y) || under(y, x);
}

const minutesLeft = (c: Claim) => Math.max(0, Math.ceil((c.expiresAt.getTime() - Date.now()) / 60_000));
// The holder is named by handle only: a display name is a peer's words, and this text reaches the model outside any envelope.
// The reason is a peer's words too: only the permission prompt (ask) carries it, inside a peer envelope.
const describe = (h: Holder, withReason = false) =>
  `@${h.handle} (${h.mode}, ${minutesLeft(h)} min left)${
    withReason && h.reason
      ? `, reason:\n${renderPeerMessage(
          {
            id: "claim-reason",
            from: h.name,
            agent: null,
            kind: "claim_reason",
            priority: "normal",
            authoredBy: "agent",
            sentAt: new Date(),
            flags: textFlags(h.reason),
          },
          null,
          h.reason,
        )}`
      : ""
  }`;

// One lock per team: task and resource claims are team-wide, so a per-project lock would let two projects race.
async function lock(tx: Db, teamId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`claims:${teamId}`}, 0))`);
}

// Live claims of other people in the same project, plus team-wide task/resource claims. Claims belong to a person: two
// sessions of the same person, and the subagents that work under a session, never conflict with each other.
async function othersLive(tx: Db, p: Principal, projectId: string | null) {
  return tx
    .select({ claim, name: user.name, handle: membership.handle })
    .from(claim)
    .innerJoin(user, eq(user.id, claim.holderUserId))
    .innerJoin(membership, and(eq(membership.userId, claim.holderUserId), eq(membership.teamId, claim.teamId)))
    .where(
      and(
        eq(claim.teamId, p.teamId),
        ne(claim.holderUserId, p.user.id),
        isNull(claim.releasedAt),
        gt(claim.expiresAt, new Date()),
        projectId ? or(eq(claim.projectId, projectId), isNull(claim.projectId)) : isNull(claim.projectId),
      ),
    )
    .then((rows) => rows.map((r): Holder => ({ ...r.claim, name: r.name, handle: r.handle })));
}

const RECENT_MS = 30 * 60_000;

// Claim rows stay after release or expiry, and every edit renews one: its expiry minus its ttl is the last time the
// holder touched the path. For each path, what other people did in the last 30 minutes under a claim that is no longer live.
async function recentEdits(tx: Db, p: Principal, projectId: string | null, paths: string[]) {
  const now = Date.now();
  const since = now - RECENT_MS;
  const rows = await tx
    .select({ claim, handle: membership.handle })
    .from(claim)
    .innerJoin(membership, and(eq(membership.userId, claim.holderUserId), eq(membership.teamId, claim.teamId)))
    .where(
      and(
        eq(claim.teamId, p.teamId),
        ne(claim.holderUserId, p.user.id),
        inArray(claim.scopeType, ["path", "glob"]),
        gt(claim.expiresAt, new Date(since)),
        or(isNotNull(claim.releasedAt), lte(claim.expiresAt, new Date(now))),
        projectId ? or(eq(claim.projectId, projectId), isNull(claim.projectId)) : isNull(claim.projectId),
      ),
    )
    .orderBy(desc(claim.expiresAt))
    .limit(200);
  return paths.map((path) => {
    const last = new Map<string, { at: number; released: boolean }>();
    for (const { claim: c, handle } of rows) {
      const at = c.expiresAt.getTime() - c.ttlS * 1000;
      if (covers(c, path) && at > since && at > (last.get(handle)?.at ?? 0)) last.set(handle, { at, released: c.releasedAt !== null });
    }
    return [...last]
      .sort((x, y) => y[1].at - x[1].at)
      .slice(0, 3)
      .map(
        ([handle, { at, released }]) =>
          `@${handle} edited this path ${Math.max(1, Math.round((now - at) / 60_000))} min ago (claim ${released ? "released" : "expired"})`,
      );
  });
}

// team_overview: live claims of the team (or of the agent's project), the caller's own included: mine is any claim of their person. No reasons: they are peer text.
export async function liveClaims(db: Db, p: Principal, opts: { projectId?: string | null; limit: number }) {
  requireMember(p);
  const rows = await db
    .select({ claim, handle: membership.handle })
    .from(claim)
    .innerJoin(membership, and(eq(membership.userId, claim.holderUserId), eq(membership.teamId, claim.teamId)))
    .where(
      and(
        eq(claim.teamId, p.teamId),
        isNull(claim.releasedAt),
        gt(claim.expiresAt, new Date()),
        opts.projectId ? or(eq(claim.projectId, opts.projectId), isNull(claim.projectId)) : undefined,
      ),
    )
    .orderBy(asc(claim.expiresAt))
    .limit(opts.limit);
  return rows.map(({ claim: c, handle }) => ({
    id: c.id,
    scope: escapeAttr(c.scope, 300),
    mode: c.mode,
    holder: `@${handle}`,
    mine: c.holderUserId === p.user.id,
    minutes_left: Math.max(1, Math.round((c.expiresAt.getTime() - Date.now()) / 60_000)),
  }));
}

// The person's claims that are neither released nor expired.
const live = (p: Principal) =>
  and(eq(claim.teamId, p.teamId), eq(claim.holderUserId, p.user.id), isNull(claim.releasedAt), gt(claim.expiresAt, new Date()));

const intentsHeld = async (tx: Db, p: Principal) =>
  (
    await tx
      .select({ n: count() })
      .from(claim)
      .where(and(live(p), eq(claim.mode, "intent")))
  )[0]?.n ?? 0;

function guard(p: Principal, a: Agent) {
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
  if (p.role === "guest") throw new HubError("E_FORBIDDEN", "guests cannot claim");
  if (a.trustLevel === "quarantined") throw new HubError("E_FORBIDDEN", "this agent is in quarantine");
}

export async function createClaims(
  deps: MessagingDeps,
  p: Principal,
  a: Agent,
  input: { scope: string[]; mode: "exclusive" | "shared"; ttl_s: number; reason?: string },
) {
  guard(p, a);
  const scopes = input.scope.map((scope) => ({ scope, scopeType: scopeType(scope) }));
  for (const s of scopes) {
    if ((s.scopeType === "path" || s.scopeType === "glob") && !a.projectId)
      throw new HubError("E_INVALID", "no project for this agent: start the session inside a git repository");
    if (isExcluded(s.scope)) throw new HubError("E_INVALID", `${s.scope} cannot be claimed (secrets and .git are excluded)`);
    if (s.scopeType === "glob" && globTooComplex(s.scope))
      throw new HubError(
        "E_INVALID",
        `${s.scope} is too complex: at most 2 wildcards (* or **), braces and commas totalling 6, no nested braces`,
      );
    if (s.scopeType === "glob" && negated(s.scope))
      throw new HubError("E_INVALID", `${s.scope}: a negated glob is not claimable, claim the paths you work on`);
    if (s.scopeType === "glob" && coversProject(s.scope))
      throw new HubError(
        "E_INVALID",
        `${s.scope} would cover the whole project and block everyone: claim a narrower path, like src/** or a file`,
      );
  }
  const reason = input.reason?.replace(/\s+/g, " ").slice(0, 200) || null;
  await assertNoSecrets(deps, { p, agent: a, via: "mcp" }, [reason ?? "", ...input.scope].join("\n"));
  const result = await deps.db.transaction(async (tx) => {
    await lock(tx, p.teamId);
    // Every check matches against all live claims: cap what one person can hold. The edit hook's intent claims have a
    // cap of their own (preEdit), and a scope this agent already holds is renewed, not added.
    const held = await tx
      .select({ scope: claim.scope, agentId: claim.holderAgentId })
      .from(claim)
      .where(and(live(p), ne(claim.mode, "intent")));
    const added = scopes.filter((s) => !held.some((h) => h.agentId === a.id && h.scope === s.scope)).length;
    if (held.length + added > MAX_LIVE_CLAIMS)
      throw new HubError("E_TOO_LARGE", `more than ${MAX_LIVE_CLAIMS} live claims: release some with claim_release`);
    const others = await othersLive(tx, p, a.projectId);
    const warnings: string[] = [];
    const notify: Holder[] = [];
    for (const s of scopes) {
      for (const h of others.filter((o) => overlaps(s, o))) {
        const verdict = compat(input.mode, h.mode);
        if (verdict === "conflict")
          throw new HubError("E_CLAIM_CONFLICT", `${s.scope} is held by ${describe(h)}. Write to them or work elsewhere.`);
        if (verdict === "warn") warnings.push(`${s.scope}: ${describe(h)} intends to edit it`);
        if (verdict === "notify" && !h.notifiedAgents.includes(a.id)) notify.push(h);
      }
    }
    const expiresAt = new Date(Date.now() + input.ttl_s * 1000);
    const created = [];
    for (const s of scopes) {
      const projectId = s.scopeType === "path" || s.scopeType === "glob" ? a.projectId : null;
      // Claiming the same scope again renews it instead of stacking claims.
      const [renewed] = await tx
        .update(claim)
        .set({ mode: input.mode, ttlS: input.ttl_s, expiresAt, reason })
        .where(and(eq(claim.holderAgentId, a.id), eq(claim.scope, s.scope), isNull(claim.releasedAt), gt(claim.expiresAt, new Date())))
        .returning();
      const [row] = renewed
        ? [renewed]
        : await tx
            .insert(claim)
            .values({
              id: newId("clm"),
              teamId: p.teamId,
              projectId,
              holderUserId: p.user.id,
              holderAgentId: a.id,
              ...s,
              mode: input.mode,
              reason,
              ttlS: input.ttl_s,
              expiresAt,
            })
            .returning();
      if (!row) throw new HubError("E_INVALID", "claim failed");
      created.push(row);
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "agent",
        actorUserId: p.user.id,
        actorAgentId: a.id,
        via: "mcp",
        action: renewed ? "claim.renewed" : "claim.created",
        subjectId: row.id,
        data: { mode: input.mode, scope_type: s.scopeType },
      });
    }
    for (const h of notify)
      await tx
        .update(claim)
        .set({ notifiedAgents: sql`array_append(${claim.notifiedAgents}, ${a.id})` })
        .where(eq(claim.id, h.id));
    return { created, warnings, notify };
  });
  // Shared holders depend on these files: one note each, sent as the claiming agent.
  for (const h of result.notify) {
    await sendMessage(
      deps,
      { p, agent: a, via: "mcp" },
      {
        to: `agent:${h.holderAgentId}`,
        kind: "note",
        body: `I claimed ${input.scope.join(", ")} (${input.mode}) which overlaps your shared claim on ${h.scope}.`,
        priority: "normal",
        refs: [],
        allow_offline: true,
      },
    ).catch(() => {});
  }
  return {
    claims: result.created.map((c) => ({ id: c.id, scope: c.scope, mode: c.mode, expires_at: c.expiresAt.toISOString() })),
    warnings: result.warnings,
  };
}

// What checkPaths answers when nothing is claimed or edited on these paths, key for key. It is also the answer for a
// repository the team has not linked, so the two cannot be told apart.
export const noClaims = (paths: string[]): Awaited<ReturnType<typeof checkPaths>>["result"] => ({
  paths: paths.map((path) => ({ path, holders: [], recent: [] })),
});

export async function checkPaths(db: Db, p: Principal, projectId: string | null, paths: string[]) {
  requireMember(p);
  const others = await othersLive(db, p, projectId);
  const recent = await recentEdits(db, p, projectId, paths);
  const holders = paths.map((path) => ({ path, holders: others.filter((h) => covers(h, path)) }));
  return {
    result: {
      paths: holders.map(({ path, holders: hs }, i) => ({
        path,
        holders: hs.map((h) => ({
          claim_id: h.id,
          handle: h.handle,
          mode: h.mode,
          remaining_min: minutesLeft(h),
        })),
        recent: recent[i] ?? [],
      })),
    },
    // Reasons are a peer's words: only in envelopes, for the claim_check tool.
    reasons: [...new Map(holders.flatMap((x) => x.holders).map((h) => [h.id, h])).values()]
      .filter((h) => h.reason)
      .map((h) =>
        renderPeerMessage(
          {
            id: h.id,
            from: h.name,
            agent: h.holderAgentId,
            kind: "claim",
            priority: "normal",
            authoredBy: "agent",
            sentAt: h.createdAt,
            flags: textFlags(h.reason ?? ""),
          },
          `Reason for claiming ${h.scope}`,
          h.reason ?? "",
        ),
      ),
  };
}

export type PreEditDecision = { decision: "warn" | "ask"; reason: string };

// One round trip for the PreToolUse hook. Never answers "allow": the permission system stays in charge.
export async function preEdit(deps: MessagingDeps, p: Principal, a: Agent, path: string): Promise<PreEditDecision | null> {
  if (p.paused || !a.projectId || isExcluded(path) || a.trustLevel === "quarantined" || p.role === "guest") return null;
  // Older teams may have stored off (now warn) or block (now ask).
  const decision = p.settings.claims_enforcement === "warn" || p.settings.claims_enforcement === "off" ? "warn" : "ask";
  const result = await deps.db.transaction(async (tx): Promise<{ answer: PreEditDecision | null; notify: Holder[] }> => {
    await lock(tx, p.teamId);
    const others = (await othersLive(tx, p, a.projectId)).filter((h) => covers(h, path));
    const conflicts = others.filter((h) => compat("intent", h.mode) === "conflict");
    if (conflicts.length) {
      const reason = `${path} is claimed by ${conflicts.map((h) => describe(h, decision === "ask")).join("; ")}. Wait, or write to them (send_message to ${conflicts.map((h) => `@${h.handle}`).join(", ")})?`;
      return { answer: { decision, reason }, notify: [] };
    }
    // Shared holders depend on this file: told once per agent, like createClaims does.
    const notify = others.filter((h) => compat("intent", h.mode) === "notify" && !h.notifiedAgents.includes(a.id));
    for (const h of notify)
      await tx
        .update(claim)
        .set({ notifiedAgents: sql`array_append(${claim.notifiedAgents}, ${a.id})` })
        .where(eq(claim.id, h.id));
    // No conflict: renew this agent's covering claims, or announce the edit with a short intent claim.
    const mine = await tx
      .select()
      .from(claim)
      .where(and(eq(claim.holderAgentId, a.id), isNull(claim.releasedAt), gt(claim.expiresAt, new Date())));
    const covering = mine.filter((c) => covers(c, path));
    if (covering.length) {
      // shortcut: renewals are bookkeeping and not audited, like presence.
      for (const c of covering)
        await tx
          .update(claim)
          .set({ expiresAt: new Date(Date.now() + c.ttlS * 1000) })
          .where(eq(claim.id, c.id));
    } else if ((await intentsHeld(tx, p)) < MAX_LIVE_CLAIMS) {
      // Past the cap the edit is not announced; the answer below stays the same.
      const id = newId("clm");
      await tx.insert(claim).values({
        id,
        teamId: p.teamId,
        projectId: a.projectId,
        holderUserId: p.user.id,
        holderAgentId: a.id,
        scopeType: "path",
        scope: path,
        mode: "intent",
        ttlS: INTENT_TTL_S,
        expiresAt: new Date(Date.now() + INTENT_TTL_S * 1000),
      });
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "agent",
        actorUserId: p.user.id,
        actorAgentId: a.id,
        via: "hook",
        action: "claim.intent_created",
        subjectId: id,
      });
    }
    const intents = others.filter((h) => h.mode === "intent");
    // The first edit of the path by this session only: the later ones have heard it.
    const [recent] = covering.length ? [] : await recentEdits(tx, p, a.projectId, [path]);
    const warnings = [
      ...(intents.length ? [`${path} is also being edited by ${intents.map((h) => describe(h)).join("; ")}.`] : []),
      ...(recent?.length ? [`${path}: ${recent.join("; ")}.`] : []),
    ];
    return { answer: warnings.length ? { decision: "warn", reason: warnings.join(" ") } : null, notify };
  });
  for (const h of result.notify) {
    await sendMessage(
      deps,
      { p, agent: a, via: "rest" },
      {
        to: `agent:${h.holderAgentId}`,
        kind: "note",
        body: `I am editing ${path}, which your shared claim on ${h.scope} covers.`,
        priority: "normal",
        refs: [],
        allow_offline: true,
      },
    ).catch(() => {});
  }
  return result.answer;
}

export async function releaseClaims(db: Db, p: Principal, a: Agent, input: { claim_ids?: string[]; all_mine?: boolean }) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(claim)
      .set({ releasedAt: new Date(), releasedBy: p.user.id, releaseReason: "released" })
      .where(
        and(
          eq(claim.teamId, p.teamId),
          isNull(claim.releasedAt),
          input.claim_ids ? and(inArray(claim.id, input.claim_ids), eq(claim.holderUserId, p.user.id)) : eq(claim.holderAgentId, a.id),
        ),
      )
      .returning({ id: claim.id });
    if (rows.length)
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "agent",
        actorUserId: p.user.id,
        actorAgentId: a.id,
        via: "mcp",
        action: "claim.released",
        data: { count: rows.length },
      });
    return rows.length;
  });
}

// Console: an admin frees a claim left behind (holder away, wrong scope).
export async function adminReleaseClaim(db: Db, p: Principal, claimId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(claim)
      .set({ releasedAt: new Date(), releasedBy: p.user.id, releaseReason: "admin" })
      .where(and(eq(claim.id, claimId), eq(claim.teamId, p.teamId), isNull(claim.releasedAt)))
      .returning({ id: claim.id });
    if (!row) throw new HubError("E_NOT_FOUND", "no active claim with this id");
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: "claim.released",
      subjectId: row.id,
    });
  });
}

// Called inside the caller's transaction (session end, revocation).
export async function releaseFor(
  tx: Db,
  where: { agentId?: string; teamId?: string; userId?: string },
  reason: "session_end" | "revoked" | "erased",
  intentOnly: boolean,
) {
  await tx
    .update(claim)
    .set({ releasedAt: new Date(), releaseReason: reason })
    .where(
      and(
        isNull(claim.releasedAt),
        where.agentId ? eq(claim.holderAgentId, where.agentId) : undefined,
        where.teamId ? eq(claim.teamId, where.teamId) : undefined,
        where.userId ? eq(claim.holderUserId, where.userId) : undefined,
        intentOnly ? eq(claim.mode, "intent") : undefined,
      ),
    );
}
