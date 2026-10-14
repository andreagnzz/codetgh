import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  account,
  agent,
  alert,
  auditEvent,
  claim,
  invitation,
  memberKey,
  membership,
  memoryItem,
  message,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  personalToken,
  receipt,
  session,
  slackLink,
  task,
  thread,
  threadKey,
  user,
} from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";
import { releaseFor } from "./claims.js";

const OPEN = ["claimed", "in_progress", "blocked", "review"] as const;

// Everything stored about the member in this team, and only what they wrote, received or did.
export async function exportMyData(db: Db, p: Principal) {
  const me = p.user.id;
  const received = db.select({ id: receipt.messageId }).from(receipt).where(eq(receipt.recipientUserId, me));
  const [profile] = await db.select({ name: user.name, email: user.email, created_at: user.createdAt }).from(user).where(eq(user.id, me));
  return {
    exported_at: new Date().toISOString(),
    profile,
    membership: { team_id: p.teamId, role: p.role, handle: p.handle },
    public_key: (
      await db
        .select({ public_key: memberKey.publicKey, created_at: memberKey.createdAt })
        .from(memberKey)
        .where(and(eq(memberKey.userId, me), eq(memberKey.teamId, p.teamId)))
    )[0],
    slack_link: (
      await db
        .select({ slack_user_id: slackLink.slackUserId })
        .from(slackLink)
        .where(and(eq(slackLink.userId, me), eq(slackLink.teamId, p.teamId)))
    )[0],
    tokens: await db
      .select({
        id: personalToken.id,
        label: personalToken.label,
        created_at: personalToken.createdAt,
        expires_at: personalToken.expiresAt,
        revoked_at: personalToken.revokedAt,
        last_used_at: personalToken.lastUsedAt,
      })
      .from(personalToken)
      .where(and(eq(personalToken.userId, me), eq(personalToken.teamId, p.teamId))),
    agents: await db
      .select({
        id: agent.id,
        label: agent.label,
        kind: agent.kind,
        branch: agent.branch,
        created_at: agent.createdAt,
        ended_at: agent.endedAt,
      })
      .from(agent)
      .where(and(eq(agent.userId, me), eq(agent.teamId, p.teamId))),
    messages_sent: await db
      .select()
      .from(message)
      .where(and(eq(message.teamId, p.teamId), eq(message.fromUserId, me)))
      .orderBy(asc(message.createdAt)),
    messages_received: await db
      .select()
      .from(message)
      .where(and(eq(message.teamId, p.teamId), inArray(message.id, received)))
      .orderBy(asc(message.createdAt)),
    claims: await db
      .select()
      .from(claim)
      .where(and(eq(claim.teamId, p.teamId), eq(claim.holderUserId, me)))
      .orderBy(asc(claim.createdAt)),
    tasks: await db
      .select()
      .from(task)
      .where(and(eq(task.teamId, p.teamId), or(eq(task.assigneeUserId, me), eq(task.createdByUser, me)))),
    memory: await db
      .select()
      .from(memoryItem)
      .where(and(eq(memoryItem.teamId, p.teamId), or(eq(memoryItem.proposedByUser, me), eq(memoryItem.decidedByUser, me)))),
    audit: await db
      .select({ seq: auditEvent.seq, action: auditEvent.action, subject_id: auditEvent.subjectId, via: auditEvent.via, at: auditEvent.at })
      .from(auditEvent)
      .where(and(eq(auditEvent.teamId, p.teamId), eq(auditEvent.actorUserId, me)))
      .orderBy(asc(auditEvent.seq)),
  };
}

// Human decision: self-service erasure. Ids stay so threads and the audit chain hold together; text and identity go.
export async function eraseMe(db: Db, p: Principal, confirm: string) {
  if (confirm !== "erase") throw new HubError("E_INVALID", "type erase to confirm");
  const me = p.user.id;
  await db.transaction(async (tx) => {
    // Serializes owners leaving the team, so two erasing at once cannot both see the other as the remaining owner.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owners:${p.teamId}`}, 0))`);
    if (p.role === "owner") {
      const [other] = await tx
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(eq(membership.teamId, p.teamId), eq(membership.role, "owner"), eq(membership.status, "active"), ne(membership.userId, me)),
        );
      if (!other) throw new HubError("E_FORBIDDEN", "you are the only owner: make someone else owner first");
    }
    const now = new Date();
    const [m] = await tx
      .update(membership)
      .set({ status: "revoked", revokedAt: now, revokedBy: me, handle: sql`'former-' || right(${membership.id}, 8)` })
      .where(and(eq(membership.teamId, p.teamId), eq(membership.userId, me)))
      .returning({ id: membership.id });
    await tx
      .update(personalToken)
      .set({ revokedAt: sql`coalesce(${personalToken.revokedAt}, now())`, label: "erased" })
      .where(eq(personalToken.userId, me));
    await tx
      .update(agent)
      .set({ endedAt: sql`coalesce(${agent.endedAt}, now())`, statusText: null, statusPaths: null, label: "former member", branch: null })
      .where(eq(agent.userId, me));
    await releaseFor(tx, { userId: me }, "erased", false);
    await tx.update(claim).set({ reason: null }).where(eq(claim.holderUserId, me));
    // Their notes on any task become [erased]; other people's notes stay.
    await tx
      .update(task)
      .set({
        notes: sql`(select coalesce(jsonb_agg(case when n->>'user_id' = ${me} then n || '{"text":"[erased]"}'::jsonb else n end), '[]'::jsonb) from jsonb_array_elements(${task.notes}) n)`,
      })
      .where(sql`${task.notes} @> ${JSON.stringify([{ user_id: me }])}::jsonb`);
    await tx
      .update(task)
      .set({
        assigneeUserId: null,
        assigneeAgentId: null,
        status: sql`case when ${inArray(task.status, OPEN)} then 'todo' else ${task.status} end`,
        version: sql`${task.version} + 1`,
        updatedAt: now,
      })
      .where(eq(task.assigneeUserId, me));
    const mine = tx.select({ id: message.id }).from(message).where(eq(message.fromUserId, me));
    await tx
      .update(alert)
      .set({ excerpt: "[erased]", detail: {} })
      .where(or(eq(alert.userId, me), inArray(alert.messageId, mine)));
    await tx.update(message).set({ body: "[erased]", subject: null, refs: [], capsule: null }).where(eq(message.fromUserId, me));
    await tx.update(thread).set({ subject: null }).where(eq(thread.createdByUser, me));
    await tx.delete(receipt).where(eq(receipt.recipientUserId, me));
    await tx
      .update(invitation)
      .set({ email: "erased" })
      .where(or(eq(invitation.acceptedUserId, me), eq(invitation.email, p.user.email)));
    await tx.delete(session).where(eq(session.userId, me));
    await tx.delete(account).where(eq(account.userId, me));
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, me));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, me));
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, me));
    await tx.delete(slackLink).where(eq(slackLink.userId, me));
    await tx.delete(memberKey).where(eq(memberKey.userId, me));
    await tx.delete(threadKey).where(eq(threadKey.userId, me));
    await tx
      .update(user)
      .set({ name: "Former member", email: `erased-${me}@invalid`, emailVerified: false, image: null })
      .where(eq(user.id, me));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: me,
      via: "console",
      action: "member.erased",
      subjectId: m?.id,
    });
  });
}
