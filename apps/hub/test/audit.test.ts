import { auditKeyFromSeed, eventHash, signCheckpoint, verifyAudit } from "@codetgh/shared/audit";
import { and, asc, desc, eq, gt, gte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { alert, auditCheckpoint, auditEvent } from "../src/db/schema.js";
import { appendAudit, exportAudit, verifyTeamAudit, writeCheckpoint } from "../src/domain/audit.js";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const key = () => hub.app.auditKey;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  for (let i = 0; i < 120; i++)
    await hub.db.transaction((tx) =>
      appendAudit(tx, { teamId: team.teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }),
    );
  await writeCheckpoint(hub.db, team.teamId, key());
  for (let i = 0; i < 130; i++)
    await hub.db.transaction((tx) =>
      appendAudit(tx, { teamId: team.teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }),
    );
  await writeCheckpoint(hub.db, team.teamId, key());
});
afterAll(() => hub.stop());

const check = async () => {
  const { events, checkpoints } = await exportAudit(hub.db, team.teamId);
  return verifyAudit(events, checkpoints, key().publicKey);
};

describe("signed audit chain", () => {
  it("verifies an untouched chain with its checkpoints", async () => {
    expect(await check()).toMatchObject({ ok: true, checkpoints: 2 });
    expect((await check()).ok && (await check()).ok).toBe(true);
  });

  it("points at the first altered event", async () => {
    const [victim] = await hub.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.teamId, team.teamId))
      .orderBy(auditEvent.seq)
      .offset(36)
      .limit(1);
    await hub.db
      .update(auditEvent)
      .set({ data: { forged: true } })
      .where(eq(auditEvent.seq, victim?.seq ?? 0));
    expect(await check()).toMatchObject({ ok: false, problem: "broken_link", seq: victim?.seq });
    await hub.db
      .update(auditEvent)
      .set({ data: victim?.data ?? {} })
      .where(eq(auditEvent.seq, victim?.seq ?? 0));
    expect((await check()).ok).toBe(true);
  });

  it("catches a chain rewritten end to end", async () => {
    const { events, checkpoints } = await exportAudit(hub.db, team.teamId);
    const { eventHash, GENESIS } = await import("@codetgh/shared/audit");
    let prev = GENESIS;
    const rewritten = events.map((e, i) => {
      const data = i === 10 ? { forged: true } : e.data;
      const hash = eventHash(prev, { ...e, data });
      const out = { ...e, data, prev_hash: prev, hash };
      prev = hash;
      return out;
    });
    expect(verifyAudit(rewritten, checkpoints, key().publicKey)).toMatchObject({ ok: false, problem: "checkpoint_mismatch" });
  });

  it("catches a cut end", async () => {
    const { events, checkpoints } = await exportAudit(hub.db, team.teamId);
    expect(verifyAudit(events.slice(0, -10), checkpoints, key().publicKey)).toMatchObject({ ok: false, problem: "truncated" });
  });

  it("refuses checkpoints signed with another key", async () => {
    const { events, checkpoints } = await exportAudit(hub.db, team.teamId);
    const other = auditKeyFromSeed(Buffer.alloc(32, 7));
    const forged = checkpoints.map((c) => signCheckpoint(other, c));
    expect(verifyAudit(events, forged, key().publicKey)).toMatchObject({ ok: false, problem: "bad_signature" });
  });

  it("fails a chain that no signed checkpoint covers", async () => {
    const { events } = await exportAudit(hub.db, team.teamId);
    expect(verifyAudit(events, [], key().publicKey)).toMatchObject({ ok: false, problem: "no_checkpoint" });
  });

  it("fails when a checkpoint's predecessor is missing", async () => {
    const { events, checkpoints } = await exportAudit(hub.db, team.teamId);
    expect(verifyAudit(events, checkpoints.slice(1), key().publicKey)).toMatchObject({
      ok: false,
      problem: "missing_checkpoint",
      seq: checkpoints[1]?.seq,
    });
  });

  it("signs a new head only when the chain moved", async () => {
    const count = async () => (await hub.db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, team.teamId))).length;
    const before = await count();
    await writeCheckpoint(hub.db, team.teamId, key());
    expect(await count()).toBe(before);
    const [head] = await hub.db.select().from(auditEvent).where(eq(auditEvent.teamId, team.teamId)).orderBy(desc(auditEvent.seq)).limit(1);
    expect(
      await hub.db
        .select()
        .from(auditEvent)
        .where(gt(auditEvent.seq, head?.seq ?? 0)),
    ).toEqual([]);
  });
});

describe("checkpoint anchor", () => {
  let other: Hub;
  let t: Awaited<ReturnType<Hub["seed"]>>;
  beforeAll(async () => {
    other = await startHub();
    t = await other.seed();
  });
  afterAll(() => other.stop());

  const append = async (n: number) => {
    for (let i = 0; i < n; i++)
      await other.db.transaction((tx) =>
        appendAudit(tx, { teamId: t.teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }),
      );
  };
  // What a DB writer can do without the audit key: rewrite events from `fromSeq` on and recompute every hash after.
  const rewriteFrom = async (fromSeq: number) => {
    const { events } = await exportAudit(other.db, t.teamId);
    let prev = events.find((e) => e.seq === fromSeq)?.prev_hash ?? "";
    for (const e of events.filter((e) => e.seq >= fromSeq)) {
      const data = { ...e.data, forged: true };
      const hash = eventHash(prev, { ...e, data });
      await other.db.update(auditEvent).set({ data, prevHash: prev, hash }).where(eq(auditEvent.seq, e.seq));
      prev = hash;
    }
  };
  const checkpoints = () => other.db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, t.teamId));
  const tamperAlerts = () =>
    other.db
      .select()
      .from(alert)
      .where(and(eq(alert.teamId, t.teamId), eq(alert.kind, "audit_tamper")));

  it("refuses to sign a forged head once the signed checkpoints were deleted", async () => {
    await append(30);
    await writeCheckpoint(other.db, t.teamId, other.app.auditKey);
    const [tenth] = await other.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.teamId, t.teamId))
      .orderBy(asc(auditEvent.seq))
      .offset(10)
      .limit(1);
    await rewriteFrom(tenth?.seq ?? 0);
    await other.db.delete(auditCheckpoint).where(eq(auditCheckpoint.teamId, t.teamId));
    await append(5);
    await writeCheckpoint(other.db, t.teamId, other.app.auditKey);
    expect(await checkpoints()).toEqual([]);
    expect(await tamperAlerts()).toHaveLength(1);
    expect(await verifyTeamAudit(other.db, t.teamId, other.app.auditKey.publicKey)).toMatchObject({
      ok: false,
      problem: "no_checkpoint",
    });
    await writeCheckpoint(other.db, t.teamId, other.app.auditKey);
    expect(await tamperAlerts()).toHaveLength(1);
  });

  it("refuses to sign when the chain no longer matches the last checkpoint", async () => {
    const fresh = await startHub();
    try {
      const s = await fresh.seed();
      for (let i = 0; i < 10; i++)
        await fresh.db.transaction((tx) =>
          appendAudit(tx, { teamId: s.teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }),
        );
      await writeCheckpoint(fresh.db, s.teamId, fresh.app.auditKey);
      const [cp] = await fresh.db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, s.teamId));
      const after = await fresh.db
        .select()
        .from(auditEvent)
        .where(and(eq(auditEvent.teamId, s.teamId), gte(auditEvent.seq, cp?.seq ?? 0)))
        .limit(1);
      await fresh.db
        .update(auditEvent)
        .set({ data: { forged: true } })
        .where(eq(auditEvent.seq, after[0]?.seq ?? 0));
      await fresh.db.transaction((tx) =>
        appendAudit(tx, { teamId: s.teamId, actorType: "hub", via: "system", action: "test.event", data: {} }),
      );
      await writeCheckpoint(fresh.db, s.teamId, fresh.app.auditKey);
      expect(await fresh.db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, s.teamId))).toHaveLength(1);
      expect(
        await fresh.db
          .select()
          .from(alert)
          .where(and(eq(alert.teamId, s.teamId), eq(alert.kind, "audit_tamper"))),
      ).toHaveLength(1);
    } finally {
      await fresh.stop();
    }
  });
});

describe("console", () => {
  it("lets an admin verify the chain and download a signed export", async () => {
    const verify = await consolePost(hub.url, team.lea.cookie, "/console/audit/verify");
    expect(await verify.text()).toContain("Chain intact");
    const res = await fetch(`${hub.url}/console/audit/export`, { headers: { cookie: team.lea.cookie } });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const file = await res.json();
    expect(file).toMatchObject({ team_id: team.teamId, public_key: key().publicKey, key_id: key().keyId });
    expect(verifyAudit(file.events, file.checkpoints, file.public_key).ok).toBe(true);
  });

  it("keeps the export from members", async () => {
    expect((await fetch(`${hub.url}/console/audit/export`, { headers: { cookie: team.sam.cookie } })).status).toBe(403);
  });
});
