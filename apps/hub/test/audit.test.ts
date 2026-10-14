import { auditKeyFromSeed, signCheckpoint, verifyAudit } from "@codetgh/shared/audit";
import { desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditCheckpoint, auditEvent } from "../src/db/schema.js";
import { appendAudit, exportAudit, writeCheckpoint } from "../src/domain/audit.js";
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

describe("console", () => {
  async function csrf(cookie: string) {
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
    return html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;/)?.[1] ?? "";
  }

  it("lets an admin verify the chain and download a signed export", async () => {
    const verify = await fetch(`${hub.url}/console/audit/verify`, {
      method: "POST",
      headers: { cookie: team.lea.cookie, "X-CSRF-Token": await csrf(team.lea.cookie) },
    });
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
