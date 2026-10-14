import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify as verifySig } from "node:crypto";

// Shared by the hub (writes and checks) and the CLI (checks an export offline): one definition of the chain.
export const GENESIS = "0".repeat(64);

export type AuditRecord = {
  seq: number;
  team_id: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  via: string;
  action: string;
  subject_id: string | null;
  data: Record<string, unknown>;
  at: string;
  prev_hash: string;
  hash: string;
};

export type Checkpoint = {
  team_id: string;
  seq: number;
  hash: string;
  prev_checkpoint_seq: number | null;
  at: string;
  key_id: string;
  sig: string;
};

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function eventHash(prev: string, e: Omit<AuditRecord, "seq" | "prev_hash" | "hash">) {
  const { team_id, actor_type, actor_user_id, actor_agent_id, via, action, subject_id, data, at } = e;
  return createHash("sha256")
    .update(prev + canonical({ team_id, actor_type, actor_user_id, actor_agent_id, via, action, subject_id, data, at }))
    .digest("hex");
}

// Ed25519 from a 32-byte seed; the PKCS#8 DER prefix wraps a raw seed so node:crypto can load it.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function auditKeyFromSeed(seed: Buffer) {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length);
  return { privateKey, publicKey: raw.toString("base64"), keyId: createHash("sha256").update(raw).digest("hex").slice(0, 16) };
}

// The audit key lives outside the database: derived from the hub secret, or given as its own seed.
export const deriveAuditSeed = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "", "codetgh audit checkpoint v1", 32));

const signedPayload = (c: Omit<Checkpoint, "key_id" | "sig">) => `${c.team_id}|${c.seq}|${c.hash}|${c.prev_checkpoint_seq ?? ""}|${c.at}`;

export function signCheckpoint(key: ReturnType<typeof auditKeyFromSeed>, c: Omit<Checkpoint, "key_id" | "sig">): Checkpoint {
  return { ...c, key_id: key.keyId, sig: sign(null, Buffer.from(signedPayload(c)), key.privateKey).toString("base64") };
}

export type VerifyResult =
  | { ok: true; events: number; checkpoints: number }
  | { ok: false; problem: "broken_link" | "checkpoint_mismatch" | "truncated" | "bad_signature"; seq: number; message: string };

// Replays the chain; signed checkpoints catch a chain rewritten end to end, or cut short.
export function verifyAudit(events: AuditRecord[], checkpoints: Checkpoint[], publicKeyB64: string | null): VerifyResult {
  const publicKey = publicKeyB64
    ? createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyB64, "base64")]), format: "der", type: "spki" })
    : null;
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const hashAt = new Map<number, string>();
  let prev = GENESIS;
  for (const e of sorted) {
    if (e.prev_hash !== prev || e.hash !== eventHash(prev, e))
      return { ok: false, problem: "broken_link", seq: e.seq, message: `first break at seq ${e.seq}` };
    hashAt.set(e.seq, e.hash);
    prev = e.hash;
  }
  const last = sorted.at(-1)?.seq ?? 0;
  for (const c of [...checkpoints].sort((a, b) => a.seq - b.seq)) {
    if (!publicKey || !verifySig(null, Buffer.from(signedPayload(c)), publicKey, Buffer.from(c.sig, "base64")))
      return {
        ok: false,
        problem: "bad_signature",
        seq: c.seq,
        message: `checkpoint at seq ${c.seq} is not signed by this hub's audit key`,
      };
    if (c.seq > last)
      return {
        ok: false,
        problem: "truncated",
        seq: c.seq,
        message: `events after seq ${last} are missing (a checkpoint covers seq ${c.seq})`,
      };
    if (hashAt.get(c.seq) !== c.hash)
      return {
        ok: false,
        problem: "checkpoint_mismatch",
        seq: c.seq,
        message: `the chain at seq ${c.seq} differs from the signed checkpoint`,
      };
  }
  return { ok: true, events: sorted.length, checkpoints: checkpoints.length };
}
