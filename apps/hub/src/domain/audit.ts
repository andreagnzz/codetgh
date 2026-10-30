import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import type { Logger } from "pino";
import { ulid } from "ulid";
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

type Witness = { team_id: string; seq: number; hash: string; at: string };

// The last checkpoint this hub signed per team, kept out of the database's reach in CODETGH_STATE_DIR: the database alone
// cannot show that signed checkpoints were deleted or the chain under them rewritten, even after a restart. Without that
// directory the witness lives in this process, and a restart forgets it.
export type WitnessStore = { dir?: string; log?: Logger };
const inMemory = new Map<string, Witness>();

// encodeURIComponent leaves no "/" in the name: a team id read from the database cannot point outside the directory.
const witnessFile = (dir: string, teamId: string) => join(dir, `audit-${encodeURIComponent(teamId)}.json`);

// null when the file does not exist yet; throws when it cannot be read or does not hold this team's checkpoint.
async function readWitness(dir: string, teamId: string): Promise<Witness | null> {
  const text = await readFile(witnessFile(dir, teamId), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (text === null) return null;
  const w = JSON.parse(text);
  if (w?.team_id !== teamId || !Number.isSafeInteger(w.seq) || !/^[0-9a-f]{64}$/.test(w.hash) || typeof w.at !== "string")
    throw new Error("malformed audit witness");
  return w;
}

// Written beside the file, flushed (fsync), then renamed over it: a crash leaves the old witness or the new one, never half.
async function saveWitness(dir: string, w: Witness) {
  const file = witnessFile(dir, w.team_id);
  const tmp = `${file}.${ulid()}.tmp`;
  await writeFile(tmp, JSON.stringify(w), { mode: 0o600, flush: true });
  await rename(tmp, file);
}

export type CheckpointResult = { status: "signed"; seq: number } | { status: "unchanged" } | { status: "refused"; problem: string };

// One check, signature and witness write at a time per team. The witness is written after the commit, so the team's
// advisory lock, released by the commit, cannot cover it; one hub process owns the state directory.
const running = new Map<string, Promise<unknown>>();

// Signs the current head when it moved since the last checkpoint, and only on top of a chain that still extends the
// witnessed checkpoint and matches the last one in the database: a hub that signed whatever head it finds would vouch for
// a log rewritten in the database. Runs on an interval and before each export.
export async function writeCheckpoint(db: Db, teamId: string, key: AuditKey, store: WitnessStore = {}): Promise<CheckpointResult> {
  // An earlier run's failure is its own caller's.
  const run = (running.get(teamId) ?? Promise.resolve()).catch(() => {}).then(() => signHead(db, teamId, key, store));
  running.set(teamId, run);
  try {
    return await run;
  } finally {
    if (running.get(teamId) === run) running.delete(teamId);
  }
}

async function signHead(db: Db, teamId: string, key: AuditKey, store: WitnessStore): Promise<CheckpointResult> {
  // undefined: the witness file exists but cannot be read, and nothing is signed until someone looks.
  const witness = store.dir ? await readWitness(store.dir, teamId).catch(() => undefined) : (inMemory.get(teamId) ?? null);
  const [result, latest] = await db.transaction(async (tx): Promise<[CheckpointResult, Witness?]> => {
    await lockTeam(tx, teamId);
    const [prev] = await tx
      .select()
      .from(auditCheckpoint)
      .where(eq(auditCheckpoint.teamId, teamId))
      .orderBy(desc(auditCheckpoint.seq))
      .limit(1);
    const from = Math.min(prev?.seq ?? Number.POSITIVE_INFINITY, witness?.seq ?? Number.POSITIVE_INFINITY);
    const events = (
      await tx
        .select()
        .from(auditEvent)
        .where(and(eq(auditEvent.teamId, teamId), Number.isFinite(from) ? gte(auditEvent.seq, from) : undefined))
        .orderBy(asc(auditEvent.seq))
    ).map(toRecord);
    const at = (seq: number) => events.find((e) => e.seq === seq);
    const head = events.at(-1);
    const broken = chainBreak(events, Number.isFinite(from) ? events[0]?.prev_hash : GENESIS);
    const problem =
      witness === undefined
        ? "the audit witness file cannot be read"
        : witness && (at(witness.seq)?.hash !== witness.hash || (broken !== null && broken >= witness.seq))
          ? `audit chain does not extend the last signed checkpoint (seq ${witness.seq})`
          : witness && (prev?.seq ?? 0) < witness.seq
            ? `signed checkpoint ${witness.seq} is gone`
            : prev && !checkpointSigned(toCheckpoint(prev), key.publicKey)
              ? `checkpoint at seq ${prev.seq} is not signed by this hub`
              : prev && at(prev.seq)?.hash !== prev.hash
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
      return [{ status: "refused", problem }];
    }
    if (!head || (prev && prev.seq >= head.seq))
      return [{ status: "unchanged" }, prev && { team_id: teamId, seq: prev.seq, hash: prev.hash, at: prev.at.toISOString() }];
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
    return [
      { status: "signed", seq: c.seq },
      { team_id: teamId, seq: c.seq, hash: c.hash, at: c.at },
    ];
  });
  // Forward only, after the commit: a witness never names a checkpoint the database does not hold, nor an older one.
  if (!latest || (witness && latest.seq <= witness.seq)) return result;
  if (!store.dir) {
    inMemory.set(teamId, latest);
    return result;
  }
  await saveWitness(store.dir, latest).catch((e: NodeJS.ErrnoException) => {
    store.log?.error({ team_id: teamId, err: e.code ?? e.name }, "audit witness not written");
    throw e;
  });
  if (witness === null)
    store.log?.warn({ team_id: teamId, seq: latest.seq }, "audit witness started now: trust on first use of the chain in the database");
  return result;
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
