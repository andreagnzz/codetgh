import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { consolePost, fakeCommand } from "../../../e2e/helpers.js";
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

// A stand-in for the claude binary: its version, the plugin list, the plugin's options and the MCP connection.
function fakeClaude(version: string, plugins: unknown[], opts = { configured: true, connected: true, pushMode: "hooks" }) {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  writeFileSync(join(dir, "plugins.json"), JSON.stringify(plugins));
  fakeCommand(
    dir,
    "claude",
    `import { readFileSync } from "node:fs";
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log(${JSON.stringify(`${version} (Claude Code)`)});
else if (args.startsWith("plugin list")) process.stdout.write(readFileSync(${JSON.stringify(join(dir, "plugins.json"))}));
else if (args === "plugin configure codetgh@codetgh --json")
  console.log(JSON.stringify(${JSON.stringify(opts.configured)} ? { configured: ["codetgh_url", "codetgh_token", "push_mode"], unconfigured: [], inputs: { push_mode: ${JSON.stringify(opts.pushMode)} } } : { configured: ["push_mode"], unconfigured: ["codetgh_url", "codetgh_token"] }));
else if (args === "mcp list")
  console.log(${JSON.stringify(opts.connected)} ? "plugin:codetgh:hub: https://hub/mcp (HTTP) - ✔ Connected" : "plugin:codetgh:hub: /mcp (HTTP) - ✘ Failed to connect");
else process.exitCode = 1;
`,
  );
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
  expect(out).toContain("ok   plugin options: hub URL and token set");
  expect(out).toContain("ok   hub tools connected in Claude Code");
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

it("says when the plugin itself has no hub URL or token, even with a token in the keychain", async () => {
  fakeClaude("2.1.296", [installedPlugin()], { configured: false, connected: false, pushMode: "hooks" });
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("ok   token: Léa (@lea, owner) in Acme web");
  expect(out).toContain("FAIL plugin options unset: codetgh_url, codetgh_token");
  expect(out).toContain("→ run codetgh setup again, or in Claude Code: /plugin configure codetgh@codetgh");
  expect(out).toContain("FAIL hub tools not connected in Claude Code: ✘ Failed to connect");
  expect(code).toBe(1);
});

it("says when the push mode is rewake but the team does not allow it, and when Claude Code is older than tested", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "", push_hooks: "on" });
  fakeClaude("2.1.250", [installedPlugin()], { configured: true, connected: true, pushMode: "rewake" });
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("FAIL push mode rewake, but this team does not allow it");
  expect(out).toContain("→ an admin allows rewake in the console Settings");
  expect(out).toContain("warn Claude Code 2.1.250 is older than 2.1.296, the version CodeTgh is tested with: claude update");
  expect(code).toBe(1);
});

it("rejects a wrong token with the way to get a new one", async () => {
  fakeClaude("2.1.296", [installedPlugin()]);
  const { out, code } = await doctor(hub.url, "ctgh_wrong");
  expect(out).toContain("FAIL token refused by the hub");
  expect(out).toContain("→ run codetgh login --url <hub address> again and confirm in the browser");
  expect(code).toBe(1);
});

it("says when the plugin is installed but off, as an earlier codetgh setup left it", async () => {
  fakeClaude("2.1.296", [{ ...installedPlugin(), enabled: false }]);
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("FAIL plugin codetgh@codetgh installed but off");
  expect(out).toContain("→ claude plugin enable codetgh@codetgh --scope user");
  expect(code).toBe(1);
});
