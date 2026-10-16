import {
  type AuditRecord,
  type auditKeyFromSeed,
  type Checkpoint,
  chainBreak,
  checkpointSigned,
  eventHash,
  GENESIS,
  signCheckpoint,
  verifyAudit,
} from "@codetgh/shared/audit";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { alert, auditCheckpoint, auditEvent } from "../db/schema.js";
import { newId } from "../ids.js";

export type AuditKey = ReturnType<typeof auditKeyFromSeed>;

export type AuditInput = {
  teamId: string;
  actorType: "user" | "agent" | "hub";
  actorUserId?: string | null;
  actorAgentId?: string | null;
  via: "mcp" | "rest" | "console" | "hook" | "system";
  action: string;
  subjectId?: string | null;
  data?: Record<string, unknown>;
};

const lockTeam = (tx: Db, teamId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${teamId}, 0))`);

const toRecord = (r: typeof auditEvent.$inferSelect): AuditRecord => ({
  seq: r.seq,
  team_id: r.teamId,
  actor_type: r.actorType,
  actor_user_id: r.actorUserId,
  actor_agent_id: r.actorAgentId,
  via: r.via,
  action: r.action,
  subject_id: r.subjectId,
  data: r.data,
  at: r.at.toISOString(),
  prev_hash: r.prevHash,
  hash: r.hash,
});

const toCheckpoint = (c: typeof auditCheckpoint.$inferSelect): Checkpoint => ({
  team_id: c.teamId,
  seq: c.seq,
  hash: c.hash,
  prev_checkpoint_seq: c.prevCheckpointSeq,
  at: c.at.toISOString(),
  key_id: c.keyId,
  sig: c.sig,
});

// Call inside the write's transaction. The per-team advisory lock serializes writers so the chain never forks;
// it is taken last in every transaction, so lock order stays fixed.
export async function appendAudit(tx: Db, input: AuditInput) {
  await lockTeam(tx, input.teamId);
  const [last] = await tx
    .select({ hash: auditEvent.hash })
    .from(auditEvent)
    .where(eq(auditEvent.teamId, input.teamId))
    .orderBy(desc(auditEvent.seq))
    .limit(1);
  const row = {
    teamId: input.teamId,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    via: input.via,
    action: input.action,
    subjectId: input.subjectId ?? null,
    data: input.data ?? {},
    at: new Date(),
  };
  const prevHash = last?.hash ?? GENESIS;
  const record = toRecord({ ...row, seq: 0, prevHash, hash: "" });
  await tx.insert(auditEvent).values({ ...row, prevHash, hash: eventHash(prevHash, record) });
}

// Highest checkpoint this process signed per team: the database alone cannot show that signed checkpoints were deleted.
const lastSigned = new Map<string, number>();

// Signs the current head when it moved since the last checkpoint, and only on top of a chain that still matches that
// checkpoint: a hub that signed whatever head it finds would vouch for a log rewritten in the database. Runs on an
// interval and before each export.
export async function writeCheckpoint(db: Db, teamId: string, key: AuditKey) {
  const signed = await db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const [prev] = await tx
      .select()
      .from(auditCheckpoint)
      .where(eq(auditCheckpoint.teamId, teamId))
      .orderBy(desc(auditCheckpoint.seq))
      .limit(1);
    const events = (
      await tx
        .select()
        .from(auditEvent)
        .where(and(eq(auditEvent.teamId, teamId), prev ? gte(auditEvent.seq, prev.seq) : undefined))
        .orderBy(asc(auditEvent.seq))
    ).map(toRecord);
    const [anchor] = events;
    const head = events.at(-1);
    const known = lastSigned.get(teamId);
    const broken = chainBreak(events, prev ? anchor?.prev_hash : GENESIS);
    const problem =
      known !== undefined && (prev?.seq ?? 0) < known
        ? `signed checkpoint ${known} is gone`
        : prev && !checkpointSigned(toCheckpoint(prev), key.publicKey)
          ? `checkpoint at seq ${prev.seq} is not signed by this hub`
          : prev && (anchor?.seq !== prev.seq || anchor.hash !== prev.hash)
            ? `the chain at seq ${prev.seq} differs from the signed checkpoint`
            : broken !== null
              ? `first break at seq ${broken}`
              : null;
    if (problem) {
      const [open] = await tx
        .select({ id: alert.id })
        .from(alert)
        .where(and(eq(alert.teamId, teamId), eq(alert.kind, "audit_tamper"), eq(alert.status, "open")))
        .limit(1);
      if (!open)
        await tx.insert(alert).values({ id: newId("alr"), teamId, kind: "audit_tamper", excerpt: `audit log not signed: ${problem}` });
      return;
    }
    if (!head || (prev && prev.seq >= head.seq)) return;
    const c = signCheckpoint(key, {
      team_id: teamId,
      seq: head.seq,
      hash: head.hash,
      prev_checkpoint_seq: prev?.seq ?? null,
      at: new Date().toISOString(),
    });
    await tx.insert(auditCheckpoint).values({
      teamId,
      seq: c.seq,
      hash: c.hash,
      prevCheckpointSeq: c.prev_checkpoint_seq,
      at: new Date(c.at),
      keyId: c.key_id,
      sig: c.sig,
    });
    return c.seq;
  });
  if (signed !== undefined) lastSigned.set(teamId, signed);
}

export async function exportAudit(db: Db, teamId: string) {
  const events = (await db.select().from(auditEvent).where(eq(auditEvent.teamId, teamId)).orderBy(asc(auditEvent.seq))).map(toRecord);
  const checkpoints = (
    await db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, teamId)).orderBy(asc(auditCheckpoint.seq))
  ).map(toCheckpoint);
  return { events, checkpoints };
}

export async function verifyTeamAudit(db: Db, teamId: string, publicKey: string | null) {
  const { events, checkpoints } = await exportAudit(db, teamId);
  return verifyAudit(events, checkpoints, publicKey);
}

// Returns the seq of the first broken event, or null when the chain is intact (chain only, no checkpoints).
export async function verifyChain(db: Db, teamId: string) {
  return chainBreak((await exportAudit(db, teamId)).events);
}
