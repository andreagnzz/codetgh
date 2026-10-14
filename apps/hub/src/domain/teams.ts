import { randomBytes } from "node:crypto";
import { ROLES, type Role } from "@codetgh/shared";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agent, invitation, membership, oauthAccessToken, oauthRefreshToken, personalToken, session, team } from "../db/schema.js";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";
import type { Mailer } from "../mailer.js";
import type { Principal } from "../principal.js";
import { hashToken } from "../tokens.js";
import { requireAdmin } from "./admin.js";
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
  input: { teamId: string; email: string; role: Role; invitedBy: string | null; via: "console" | "rest" | "system" },
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
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
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
  input: { email: string; role: string },
  via: "console" | "rest",
) {
  requireAdmin(p);
  if (!(ROLES as readonly string[]).includes(input.role)) throw new HubError("E_INVALID", "role must be member, admin, guest or owner");
  const role = input.role as Role;
  if (role === "owner" && p.role !== "owner") throw new HubError("E_FORBIDDEN", "only an owner invites owners");
  if (!/^[^\s@]+@[^\s@]+$/.test(input.email)) throw new HubError("E_INVALID", "invalid email");
  const { token } = await createInvitation(deps.db, { teamId: p.teamId, email: input.email, role, invitedBy: p.user.id, via });
  const link = `${deps.publicUrl}/invite/${token}`;
  if (deps.mailer.enabled) {
    await deps.mailer.send({
      to: input.email,
      subject: `Join ${p.teamName} on CodeTgh`,
      text: `${p.user.name} invited you to ${p.teamName} on CodeTgh as ${role}.\nAccept within 7 days:\n${link}`,
    });
  }
  return { link, email: input.email, role, emailed: deps.mailer.enabled, expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString() };
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

// Turns every pending invitation for this email into a membership with a unique handle.
export async function acceptInvitations(db: Db, user: { id: string; name: string; email: string }) {
  const invites = await db.select().from(invitation).where(pending(user.email));
  for (const inv of invites) {
    await db.transaction(async (tx) => {
      const taken = new Set(
        (await tx.select({ h: membership.handle }).from(membership).where(eq(membership.teamId, inv.teamId))).map((r) => r.h),
      );
      const base = slugify(user.name);
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
