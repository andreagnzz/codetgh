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
const witnessOf = (dir: string, teamId: string) => JSON.parse(readFileSync(witnessFile(dir, teamId), "utf8"));
const logTo = (lines: string[]) => pino({}, { write: (line: string) => void lines.push(line) });
const append = async (db: Hub["db"], teamId: string, n: number) => {
  for (let i = 0; i < n; i++)
    await db.transaction((tx) => appendAudit(tx, { teamId, actorType: "hub", via: "system", action: "test.event", data: { i } }));
};
const checkpoints = (db: Hub["db"], teamId: string) =>
  db.select().from(auditCheckpoint).where(eq(auditCheckpoint.teamId, teamId)).orderBy(asc(auditCheckpoint.seq));
const tamperExcerpts = async (teamId: string) =>
  (
    await hub.db
      .select()
      .from(alert)
      .where(and(eq(alert.teamId, teamId), eq(alert.kind, "audit_tamper")))
  ).map((a) => a.excerpt);
// What a DB writer can do without the audit key: rewrite the events after the kept checkpoint, recompute every hash
// after them, and delete the checkpoints that covered them.
const rewriteAbove = async (db: Hub["db"], teamId: string, keptSeq: number) => {
  const { events } = await exportAudit(db, teamId);
  const tail = events.filter((e) => e.seq > keptSeq);
  let prev = tail[0]?.prev_hash ?? "";
  for (const e of tail) {
    const data = { ...e.data, forged: true };
    const hash = eventHash(prev, { ...e, data });
    await db.update(auditEvent).set({ data, prevHash: prev, hash }).where(eq(auditEvent.seq, e.seq));
    prev = hash;
  }
  await db.delete(auditCheckpoint).where(and(eq(auditCheckpoint.teamId, teamId), gt(auditCheckpoint.seq, keptSeq)));
};
// A restart: a fresh copy of the module, so nothing the process remembered survives; the database and the state directory do.
const restarted = async () => {
  vi.resetModules();
  return (await import("../src/domain/audit.js")) as typeof import("../src/domain/audit.js");
};

describe("audit witness", () => {
  it("signs nothing after a restart over a chain rewritten under the last signed checkpoint", async () => {
    const dir = stateDir();
    const teamId = await createTeam(hub.db, "Witness rewrite");
    await append(hub.db, teamId, 10);
    await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir });
    const [kept] = await checkpoints(hub.db, teamId);
    await append(hub.db, teamId, 10);
    expect(await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir })).toMatchObject({ status: "signed" });
    await rewriteAbove(hub.db, teamId, kept?.seq ?? 0);
    await append(hub.db, teamId, 3);

    const audit = await restarted();
    expect(await audit.writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir })).toEqual({
      status: "refused",
      problem: expect.stringContaining("audit chain does not extend the last signed checkpoint"),
    });
    expect((await checkpoints(hub.db, teamId)).map((c) => c.seq)).toEqual([kept?.seq]);
    expect(await tamperExcerpts(teamId)).toEqual([expect.stringContaining("audit chain does not extend the last signed checkpoint")]);
  });

  it("starts on first use when the witness file is missing, after checking the chain", async () => {
    const dir = stateDir();
    const lines: string[] = [];
    const teamId = await createTeam(hub.db, "Witness first use");
    await append(hub.db, teamId, 5);
    const signed = await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir, log: logTo(lines) });
    const [c] = await checkpoints(hub.db, teamId);
    expect(signed).toEqual({ status: "signed", seq: c?.seq });
    const recorded = { team_id: teamId, seq: c?.seq, hash: c?.hash, at: c?.at.toISOString() };
    expect(witnessOf(dir, teamId)).toEqual(recorded);
    expect(lines.join("\n")).toContain("trust on first use");

    // A new volume over a chain that did not move: the witness starts at the checkpoint already signed.
    const fresh = stateDir();
    expect(await (await restarted()).writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir: fresh })).toEqual({
      status: "unchanged",
    });
    expect(await checkpoints(hub.db, teamId)).toHaveLength(1);
    expect(witnessOf(fresh, teamId)).toEqual(recorded);
  });

  it("signs nothing while the witness file is malformed", async () => {
    const dir = stateDir();
    const teamId = await createTeam(hub.db, "Witness malformed");
    await append(hub.db, teamId, 5);
    writeFileSync(witnessFile(dir, teamId), "{not json");
    expect(await writeCheckpoint(hub.db, teamId, hub.app.auditKey, { dir })).toEqual({
      status: "refused",
      problem: expect.stringContaining("witness"),
    });
    expect(await checkpoints(hub.db, teamId)).toEqual([]);
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
      const first = witnessOf(dir, team.teamId);
      await append(own.db, team.teamId, 4);
      await (await restarted()).writeCheckpoint(own.db, team.teamId, own.app.auditKey, { dir });
      expect(witnessOf(dir, team.teamId).seq).toBeGreaterThan(first.seq);
      expect(await verifyTeamAudit(own.db, team.teamId, own.app.auditKey.publicKey)).toMatchObject({ ok: true, checkpoints: 2 });
      expect(lines.join("\n")).not.toContain("CODETGH_STATE_DIR");
      await own.auth.$context;
    } finally {
      await own.stop();
    }
  });

  it("tells the console and the log that no checkpoint was signed, where the chain alone looks intact", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const dir = stateDir();
    const lines: string[] = [];
    const own = await startHub({ logLines: lines, config: { stateDir: dir } });
    try {
      const team = await own.seed();
      const verify = async (cookie = team.lea.cookie) => (await consolePost(own.url, cookie, "/console/audit/verify")).text();
      expect(await verify()).toContain("Chain intact");
      const kept = witnessOf(dir, team.teamId).seq;
      await append(own.db, team.teamId, 3);
      expect(await verify()).toContain("Chain intact");
      await rewriteAbove(own.db, team.teamId, kept);
      // The rewritten chain still matches the checkpoint left in the database.
      expect(await verifyTeamAudit(own.db, team.teamId, own.app.auditKey.publicKey)).toMatchObject({ ok: true });

      const shown = await verify();
      expect(shown).toContain("No checkpoint was signed");
      expect(shown).toContain("audit chain does not extend the last signed checkpoint");
      expect(shown).toContain("docs/DEPLOY.md");
      expect(shown).not.toContain("Chain intact");
      expect(await verify(`${team.lea.cookie}; lang=fr`)).toContain("Aucun point de contrôle");
      const exported = await fetch(`${own.url}/console/audit/export`, { headers: { cookie: team.lea.cookie } });
      expect(exported.status).toBe(409);
      expect(exported.headers.get("content-disposition")).toBeNull();
      expect(await exported.text()).toContain("No checkpoint was signed");

      vi.advanceTimersByTime(10 * 60_000);
      await vi.waitFor(() => expect(lines.join("\n")).toContain("audit chain does not extend the last signed checkpoint"), {
        timeout: 5000,
      });
      expect(lines.join("\n")).not.toContain(own.config.secret);
      await own.auth.$context;
    } finally {
      vi.useRealTimers();
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
