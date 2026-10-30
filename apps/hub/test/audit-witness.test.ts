import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventHash } from "@codetgh/shared/audit";
import { and, asc, eq, gt } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { alert, auditCheckpoint, auditEvent } from "../src/db/schema.js";
import { appendAudit, exportAudit, verifyTeamAudit, writeCheckpoint } from "../src/domain/audit.js";
import { createTeam } from "../src/domain/teams.js";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
beforeAll(async () => {
  hub = await startHub();
});
afterAll(() => hub.stop());

const stateDir = () => mkdtempSync(join(tmpdir(), "codetgh-witness-"));
const witnessFile = (dir: string, teamId: string) => join(dir, `audit-${teamId}.json`);
const logTo = (lines: string[]) => pino({}, { write: (line: string) => void lines.push(line) });
const append = async (db: Hub["db"], teamId: string, n: number) => {
  for (let i = 0; i < n; i++)
    await db.transaction((tx) => appendAudit(tx, { teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }));
};
const checkpoints = (teamId: string) =>
  hub.db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, teamId)).orderBy(asc(auditCheckpoint.seq));
const tamperExcerpts = async (teamId: string) =>
  (
    await hub.db
      .select()
      .from(alert)
      .where(and(eq(alert.teamId, teamId), eq(alert.kind, "audit_tamper")))
  ).map((a) => a.excerpt);
// What a DB writer can do without the audit key: rewrite events from `fromSeq` on and recompute every hash after.
const rewriteFrom = async (teamId: string, fromSeq: number) => {
  const { events } = await exportAudit(hub.db, teamId);
  let prev = events.find((e) => e.seq === fromSeq)?.prev_hash ?? "";
  for (const e of events.filter((e) => e.seq >= fromSeq)) {
    const data = { ...e.data, forged: true };
    const hash = eventHash(prev, { ...e, data });
    await hub.db.update(auditEvent).set({ data, prevHash: prev, hash }).where(eq(auditEvent.seq, e.seq));
    prev = hash;
  }
};
// A restart: a fresh copy of the module, so nothing the process remembered survives; the database and the state directory do.
const restarted = async () => {
  vi.resetModules();
  return (await import("../src/domain/audit.js")) as typeof import("../src/domain/audit.js");
};

describe("audit witness", () => {
  it("signs nothing after a restart over a chain rewritten under the last signed checkpoint", async () => {
    const dir = stateDir();
    const lines: string[] = [];
    const teamId = await createTeam(hub.db, "Witness rewrite");
    await append(hub.db, teamId, 10);
    await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir });
    const [kept] = await checkpoints(teamId);
    await append(hub.db, teamId, 10);
    await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir });
    expect(await checkpoints(teamId)).toHaveLength(2);
    // The writer forges an event the second checkpoint covers, recomputes the hashes after it and deletes that checkpoint.
    const [victim] = await hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.teamId, teamId), gt(auditEvent.seq, kept?.seq ?? 0)))
      .orderBy(asc(auditEvent.seq))
      .limit(1);
    await rewriteFrom(teamId, victim?.seq ?? 0);
    await hub.db.delete(auditCheckpoint).where(and(eq(auditCheckpoint.teamId, teamId), gt(auditCheckpoint.seq, kept?.seq ?? 0)));
    await append(hub.db, teamId, 3);

    const audit = await restarted();
    await audit.writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir, log: logTo(lines) });
    expect((await checkpoints(teamId)).map((c) => c.seq)).toEqual([kept?.seq]);
    expect(await tamperExcerpts(teamId)).toEqual([expect.stringContaining("audit chain does not extend the last signed checkpoint")]);
    expect(lines.join("\n")).toContain("audit chain does not extend the last signed checkpoint");
    expect(lines.join("\n")).not.toContain(hub.config.secret);
  });

  it("starts on first use when the witness file is missing, after checking the chain", async () => {
    const dir = stateDir();
    const lines: string[] = [];
    const teamId = await createTeam(hub.db, "Witness first use");
    await append(hub.db, teamId, 5);
    await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir, log: logTo(lines) });
    const [c] = await checkpoints(teamId);
    const recorded = { team_id: teamId, seq: c?.seq, hash: c?.hash, at: c?.at.toISOString() };
    expect(JSON.parse(readFileSync(witnessFile(dir, teamId), "utf8"))).toEqual(recorded);
    expect(lines.join("\n")).toContain("trust on first use");

    // A new volume over a chain that did not move: the witness starts at the checkpoint already signed.
    const fresh = stateDir();
    await (await restarted()).writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir: fresh });
    expect(await checkpoints(teamId)).toHaveLength(1);
    expect(JSON.parse(readFileSync(witnessFile(fresh, teamId), "utf8"))).toEqual(recorded);
  });

  it("signs nothing while the witness file is malformed", async () => {
    const dir = stateDir();
    const teamId = await createTeam(hub.db, "Witness malformed");
    await append(hub.db, teamId, 5);
    writeFileSync(witnessFile(dir, teamId), "{not json");
    await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir });
    expect(await checkpoints(teamId)).toEqual([]);
    expect(await tamperExcerpts(teamId)).toEqual([expect.stringContaining("witness")]);
    expect(readFileSync(witnessFile(dir, teamId), "utf8")).toBe("{not json");
  });

  it("keeps signing through the hub across a restart when CODETGH_STATE_DIR is set", async () => {
    const dir = stateDir();
    const lines: string[] = [];
    const own = await startHub({ logLines: lines, config: { stateDir: dir } });
    try {
      const team = await own.seed();
      expect(await (await consolePost(own.url, team.lea.cookie, "/console/audit/verify")).text()).toContain("Chain intact");
      const first = JSON.parse(readFileSync(witnessFile(dir, team.teamId), "utf8"));
      await append(own.db, team.teamId, 4);
      await (await restarted()).writeCheckpoint(own.db, team.teamId, own.app.auditKey, { dir });
      expect(JSON.parse(readFileSync(witnessFile(dir, team.teamId), "utf8")).seq).toBeGreaterThan(first.seq);
      expect(await verifyTeamAudit(own.db, team.teamId, own.app.auditKey.publicKey)).toMatchObject({ ok: true, checkpoints: 2 });
      expect(lines.join("\n")).not.toContain("CODETGH_STATE_DIR");
      await own.auth.$context;
    } finally {
      await own.stop();
    }
  });

  it("warns once at start when CODETGH_STATE_DIR is not writable", async () => {
    const lines: string[] = [];
    const own = await startHub({ logLines: lines, config: { stateDir: join(stateDir(), "missing") } });
    await own.auth.$context;
    await own.stop();
    expect(lines.filter((l) => l.includes("CODETGH_STATE_DIR"))).toHaveLength(1);
  });
});
