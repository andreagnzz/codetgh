import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const PATH = process.env.PATH;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-doctor-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  process.env.PATH = PATH;
  delete process.env.CODETGH_URL;
});

// A stand-in for the claude binary: its version and the plugin list it prints.
function fakeClaude(version: string, plugins: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  writeFileSync(join(dir, "plugins.json"), JSON.stringify(plugins));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi\nif [ "$1 $2" = "plugin list" ]; then cat "${dir}/plugins.json"; exit 0; fi\nexit 1\n`,
  );
  chmodSync(bin, 0o755);
  process.env.PATH = `${dir}${delimiter}${PATH}`;
}
function installedPlugin() {
  const path = mkdtempSync(join(tmpdir(), "codetgh-plugin-"));
  mkdirSync(join(path, "dist"));
  mkdirSync(join(path, "hooks"));
  writeFileSync(join(path, "dist/hook.js"), "");
  writeFileSync(join(path, "hooks/hooks.json"), "{}");
  return { id: "codetgh@codetgh", version: "0.0.1", enabled: true, installPath: path };
}

async function doctor(url: string, token: string) {
  const store = new Map([[url, token]]);
  const keyring: Keyring = { get: (u) => store.get(u) ?? null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = url;
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "doctor"]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

it("checks the hub, the token, Claude Code, the plugin and its hooks on one screen", async () => {
  fakeClaude("2.1.296", [installedPlugin()]);
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toMatch(/ok {3}hub reachable in \d+ ms/);
  expect(out).toContain("ok   token: Léa (@lea, owner) in Acme web");
  expect(out).toContain("ok   Claude Code 2.1.296");
  expect(out).toContain("ok   plugin codetgh@codetgh 0.0.1 enabled");
  expect(out).toContain("ok   hooks: hook.js present, node on PATH");
  expect(code).toBe(0);
  // Not a terminal here: the banner has no color codes.
  expect(out.split("\n")[0]).toBe("CodeTgh doctor · Plusieurs Claude Code, une même ligne.");
});

it("with the hub stopped, says so quickly and what to do", async () => {
  fakeClaude("2.1.296", [installedPlugin()]);
  const started = Date.now();
  const { out, code } = await doctor("http://127.0.0.1:9", team.lea.token);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(out).toContain("FAIL hub unreachable at http://127.0.0.1:9");
  expect(out).toMatch(/→ .*(start the hub|address)/);
  expect(out).not.toContain(team.lea.token);
  expect(code).toBe(1);
});

it("names the fix when Claude Code is too old or the plugin is missing", async () => {
  fakeClaude("2.1.100", []);
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("FAIL Claude Code 2.1.100");
  expect(out).toContain("→ update Claude Code");
  expect(out).toContain("FAIL plugin codetgh@codetgh not installed");
  expect(out).toContain(`claude plugin marketplace add ${hub.url}/plugin/marketplace.json`);
  expect(code).toBe(1);
});

it("rejects a wrong token with the way to get a new one", async () => {
  fakeClaude("2.1.296", [installedPlugin()]);
  const { out, code } = await doctor(hub.url, "ctgh_wrong");
  expect(out).toContain("FAIL token refused by the hub");
  expect(out).toContain("→ create a token in the console");
  expect(code).toBe(1);
});
