import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { auditKeyFromSeed } from "@codetgh/shared/audit";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let dir: string;
let exported: { team_id: string; public_key: string; events: Array<{ seq: number; data: unknown }>; checkpoints: unknown[] };
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  dir = mkdtempSync(join(tmpdir(), "codetgh-audit-"));
  process.env.CODETGH_CONFIG_DIR = dir;
  exported = await (await fetch(`${hub.url}/console/audit/export`, { headers: { cookie: team.lea.cookie } })).json();
});
afterAll(() => hub.stop());

async function verify(file: object, extra: string[] = []) {
  const path = join(dir, `export-${Math.random()}.json`);
  writeFileSync(path, JSON.stringify(file));
  const out: string[] = [];
  process.exitCode = 0;
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  await program({ keyring: async () => ({ get: () => null, set: () => {}, delete: () => {} }), io }).parseAsync([
    "node",
    "codetgh",
    "audit",
    "verify",
    path,
    ...extra,
  ]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

it("verifies an export and pins the hub's audit key on first use", async () => {
  const r = await verify(exported, ["--public-key", exported.public_key]);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/Chain intact: \d+ events, 1 signed checkpoint/);
});

it("names the first broken event of a tampered export", async () => {
  const tampered = structuredClone(exported);
  const victim = tampered.events[2];
  if (victim) victim.data = { forged: true };
  const r = await verify(tampered);
  expect(r.code).toBe(1);
  expect(r.out).toContain(`first break at seq ${victim?.seq}`);
});

it("refuses an export signed by another key than the pinned one", async () => {
  const other = auditKeyFromSeed(Buffer.alloc(32, 9));
  const r = await verify({ ...exported, public_key: other.publicKey });
  expect(r.code).toBe(1);
  expect(r.out).toContain("does not match the key pinned");
});

it("refuses an older export cut below a checkpoint already verified", async () => {
  const r = await verify({ ...exported, events: exported.events.slice(0, 3), checkpoints: [] });
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/older than|truncated/);
});
