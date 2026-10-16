import { randomBytes } from "node:crypto";
import { ROLES, type Role } from "@codetgh/shared";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agent, invitation, membership, oauthAccessToken, oauthRefreshToken, personalToken, session, team, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Mailer } from "../mailer.js";
import type { Principal } from "../principal.js";
import { hashToken } from "../tokens.js";
import { RESERVED_HANDLE, requireAdmin } from "./admin.js";
import { appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "member";

export async function createTeam(db: Db, name: string) {
  const id = newId("team");
  await db.transaction(async (tx) => {
    await tx.insert(team).values({ id, name, slug: `${slugify(name)}-${id.slice(-6).toLowerCase()}` });
    await appendAudit(tx, { teamId: id, actorType: "hub", via: "system", action: "team.created", subjectId: id });
  });
  return id;
}

export async function createInvitation(
  db: Db,
  input: { teamId: string; email: string; role: Role; invitedBy: string | null; via: "console" | "rest" | "system"; days?: number },
) {
  const token = randomBytes(24).toString("base64url");
  const id = newId("inv");
  await db.transaction(async (tx) => {
    await tx.insert(invitation).values({
      id,
      teamId: input.teamId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + (input.days ? input.days * 86_400_000 : INVITE_TTL_MS)),
    });
    await appendAudit(tx, {
      teamId: input.teamId,
      actorType: input.invitedBy ? "user" : "hub",
      actorUserId: input.invitedBy,
      via: input.via,
      action: "invitation.created",
      subjectId: id,
      data: { role: input.role },
    });
  });
  return { id, token };
}

const pending = (email: string) =>
  and(
    eq(invitation.email, email.toLowerCase()),
    isNull(invitation.acceptedAt),
    isNull(invitation.revokedAt),
    gt(invitation.expiresAt, new Date()),
  );

// An admin invites one email address; the link is always returned, so it can be delivered another way if the email bounces.
export async function inviteMember(
  deps: { db: Db; mailer: Mailer; publicUrl: string },
  p: Principal,
  input: { email: string; role: string; days?: number },
  via: "console" | "rest",
) {
  requireAdmin(p);
  const days = input.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new HubError("E_INVALID", "an invitation lasts between 1 and 30 days");
  if (!(ROLES as readonly string[]).includes(input.role)) throw new HubError("E_INVALID", "role must be member, admin, guest or owner");
  const role = input.role as Role;
  if (role === "owner" && p.role !== "owner") throw new HubError("E_FORBIDDEN", "only an owner invites owners");
  if (!/^[^\s@]+@[^\s@]+$/.test(input.email)) throw new HubError("E_INVALID", "invalid email");
  const { token } = await createInvitation(deps.db, { teamId: p.teamId, email: input.email, role, invitedBy: p.user.id, via, days });
  const link = `${deps.publicUrl}/invite/${token}`;
  if (deps.mailer.enabled) {
    await deps.mailer.send({
      to: input.email,
      subject: `Join ${p.teamName} on CodeTgh`,
      text: `${p.user.name} invited you to ${p.teamName} on CodeTgh as ${role}.\nAccept within ${days} days:\n${link}`,
    });
  }
  const expires_at = new Date(Date.now() + days * 86_400_000).toISOString();
  return { link, email: input.email, role, emailed: deps.mailer.enabled, days, expires_at };
}

// An admin cancels invitations not used yet, by id (console) or by email (CLI); their links stop working at once.
export async function revokeInvitations(db: Db, p: Principal, by: { id: string } | { email: string }, via: "console" | "rest") {
  requireAdmin(p);
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(invitation)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitation.teamId, p.teamId),
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
          "id" in by ? eq(invitation.id, by.id) : eq(invitation.email, by.email.toLowerCase()),
        ),
      )
      .returning({ id: invitation.id });
    if (!rows.length) throw new HubError("E_NOT_FOUND", "no pending invitation to revoke");
    for (const r of rows)
      await appendAudit(tx, {
        teamId: p.teamId,
        actorType: "user",
        actorUserId: p.user.id,
        via,
        action: "invitation.revoked",
        subjectId: r.id,
      });
    return rows.length;
  });
}

export async function setMemberHandle(db: Db, p: Principal, membershipId: string, handle: string) {
  requireAdmin(p);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(handle))
    throw new HubError("E_INVALID", "a handle uses lowercase letters, digits and dashes (40 at most)");
  if (RESERVED_HANDLE.test(handle)) throw new HubError("E_INVALID", "handles starting with bridge- or a2a- are reserved");
  await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: membership.id })
      .from(membership)
      .where(and(eq(membership.teamId, p.teamId), eq(membership.handle, handle)));
    if (taken && taken.id !== membershipId) throw new HubError("E_INVALID", `@${handle} is already taken in this team`);
    const rows = await tx
      .update(membership)
      .set({ handle })
      .where(and(eq(membership.id, membershipId), eq(membership.teamId, p.teamId)))
      .returning({ id: membership.id });
    if (!rows.length) throw new HubError("E_NOT_FOUND", "member not found");
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: "member.handle_changed",
      subjectId: membershipId,
    });
  });
}

export async function setDisplayName(db: Db, p: Principal, name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 60) throw new HubError("E_INVALID", "a display name has 1 to 60 characters");
  await db.transaction(async (tx) => {
    await tx.update(user).set({ name: clean }).where(eq(user.id, p.user.id));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: "member.renamed",
      subjectId: p.membershipId,
    });
  });
}

export async function renameTeam(db: Db, p: Principal, name: string) {
  requireAdmin(p);
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 80) throw new HubError("E_INVALID", "a team name has 1 to 80 characters");
  await db.transaction(async (tx) => {
    await tx.update(team).set({ name: clean }).where(eq(team.id, p.teamId));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: "team.renamed",
      subjectId: p.teamId,
    });
  });
}

export async function hasPendingInvitation(db: Db, email: string) {
  return (await db.select({ id: invitation.id }).from(invitation).where(pending(email)).limit(1)).length > 0;
}

// Possession of the invitation link proves the email for password sign-ups.
export async function invitationMatches(db: Db, token: string, email: string) {
  const rows = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.tokenHash, hashToken(token)), pending(email)));
  return rows.length > 0;
}

export async function findInvitation(db: Db, token: string) {
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      teamName: team.name,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
    })
    .from(invitation)
    .innerJoin(team, eq(team.id, invitation.teamId))
    .where(eq(invitation.tokenHash, hashToken(token)));
  return row ?? null;
}

// Turns one pending invitation into a membership with a unique handle: the one whose link was used, else the oldest.
// One team per person: another team inviting the same email must not add a second one.
export async function acceptInvitations(db: Db, user: { id: string; name: string; email: string }, token?: string | null) {
  const [inv] = await db
    .select()
    .from(invitation)
    .where(token ? and(eq(invitation.tokenHash, hashToken(token)), pending(user.email)) : pending(user.email))
    .orderBy(asc(invitation.createdAt))
    .limit(1);
  if (inv)
    await db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: membership.id })
        .from(membership)
        .where(and(eq(membership.userId, user.id), eq(membership.status, "active")))
        .limit(1);
      if (active) return;
      const taken = new Set(
        (await tx.select({ h: membership.handle }).from(membership).where(eq(membership.teamId, inv.teamId))).map((r) => r.h),
      );
      const slug = slugify(user.name);
      const base = RESERVED_HANDLE.test(slug) ? `member-${slug}` : slug;
      let handle = base;
      for (let i = 2; taken.has(handle); i++) handle = `${base}-${i}`;
      const id = newId("mem");
      await tx.insert(membership).values({ id, teamId: inv.teamId, userId: user.id, role: inv.role, handle }).onConflictDoNothing();
      await tx.update(invitation).set({ acceptedAt: new Date(), acceptedUserId: user.id }).where(eq(invitation.id, inv.id));
      await appendAudit(tx, {
        teamId: inv.teamId,
        actorType: "user",
        actorUserId: user.id,
        via: "console",
        action: "invitation.accepted",
        subjectId: id,
        data: { role: inv.role },
      });
    });
}

// Cuts every way in at once: tokens, OAuth grants, console sessions, agents. The principal check runs on every request.
export async function revokeMember(db: Db, input: { teamId: string; membershipId: string; actorUserId: string; actorRole: Role }) {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.id, input.membershipId), eq(membership.teamId, input.teamId)));
    if (!m || m.status !== "active") throw new HubError("E_NOT_FOUND", "member not found");
    if (m.role === "owner" && input.actorRole !== "owner") throw new HubError("E_FORBIDDEN", "an admin cannot revoke an owner");
    if (m.userId === input.actorUserId) throw new HubError("E_FORBIDDEN", "you cannot revoke yourself");
    const now = new Date();
    await tx.update(membership).set({ status: "revoked", revokedAt: now, revokedBy: input.actorUserId }).where(eq(membership.id, m.id));
    await tx
      .update(personalToken)
      .set({ revokedAt: now })
      .where(and(eq(personalToken.userId, m.userId), eq(personalToken.teamId, input.teamId), isNull(personalToken.revokedAt)));
    await tx
      .update(agent)
      .set({ endedAt: now })
      .where(and(eq(agent.userId, m.userId), eq(agent.teamId, input.teamId), isNull(agent.endedAt)));
    await releaseFor(tx, { teamId: input.teamId, userId: m.userId }, "revoked", false);
    // shortcut: one team per person in phase 1, so console sessions and OAuth grants are dropped globally.
    await tx.delete(session).where(eq(session.userId, m.userId));
    await tx.delete(oauthAccessToken).where(inArray(oauthAccessToken.userId, [m.userId]));
    await tx.delete(oauthRefreshToken).where(inArray(oauthRefreshToken.userId, [m.userId]));
    await appendAudit(tx, {
      teamId: input.teamId,
      actorType: "user",
      actorUserId: input.actorUserId,
      via: "console",
      action: "member.revoked",
      subjectId: m.id,
    });
    return m.userId;
  });
}
