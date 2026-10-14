import { isPublicKey } from "@codetgh/shared/e2e";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { memberKey, membership, message, threadKey } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";

// The hub only relays public keys and wrapped thread keys; it never holds anything that opens a body.
export async function publishKey(db: Db, p: Principal, publicKey: string) {
  if (!isPublicKey(publicKey)) throw new HubError("E_INVALID", "not an X25519 public key (SPKI DER, base64url)");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ publicKey: memberKey.publicKey })
      .from(memberKey)
      .where(and(eq(memberKey.teamId, p.teamId), eq(memberKey.userId, p.user.id)));
    if (current?.publicKey === publicKey) return;
    await tx
      .insert(memberKey)
      .values({ teamId: p.teamId, userId: p.user.id, publicKey })
      .onConflictDoUpdate({ target: [memberKey.teamId, memberKey.userId], set: { publicKey, createdAt: new Date() } });
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "rest",
      action: "key.published",
      subjectId: p.membershipId,
    });
  });
}

export async function publicKeys(db: Db, p: Principal, handles: string[]) {
  const rows = await db
    .select({ handle: membership.handle, publicKey: memberKey.publicKey })
    .from(membership)
    .leftJoin(memberKey, and(eq(memberKey.userId, membership.userId), eq(memberKey.teamId, membership.teamId)))
    .where(
      and(
        eq(membership.teamId, p.teamId),
        eq(membership.status, "active"),
        inArray(
          membership.handle,
          handles.map((h) => h.replace(/^@/, "")),
        ),
      ),
    );
  return { keys: rows.map((r) => ({ handle: `@${r.handle}`, public_key: r.publicKey ?? null })) };
}

// The caller's wrapped keys for these threads; a thread they hold no key for is simply absent.
export async function wrappedKeys(db: Db, p: Principal, threadIds: string[]) {
  if (!threadIds.length) return new Map<string, string>();
  const rows = await db
    .select()
    .from(threadKey)
    .where(and(eq(threadKey.userId, p.user.id), inArray(threadKey.threadId, threadIds)));
  return new Map(rows.map((r) => [r.threadId, r.wrapped]));
}

export async function threadKeyForMessage(db: Db, p: Principal, messageId: string) {
  const [m] = await db
    .select({ threadId: message.threadId })
    .from(message)
    .where(and(eq(message.id, messageId), eq(message.teamId, p.teamId)));
  const wrapped = m && (await wrappedKeys(db, p, [m.threadId])).get(m.threadId);
  // Same answer for an unknown message and a thread you hold no key for.
  if (!m || !wrapped) throw new HubError("E_NOT_FOUND", "no key of yours for this message's thread");
  return { thread: m.threadId, wrapped };
}
