import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { fakeCommand } from "../../../e2e/helpers.js";
import { program } from "../src/main.js";

// A hub that only answers whoami, with the push modes the team allows.
let allowed: string[] = [];
const hubStub = createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({ user: { name: "Sam" }, team: { name: "Acme web" }, role: "member", handle: "sam", push_allowed_modes: allowed }),
  );
});
let hub: string;
beforeAll(async () => {
  await new Promise<void>((r) => hubStub.listen(0, "127.0.0.1", r));
  hub = `http://127.0.0.1:${(hubStub.address() as AddressInfo).port}`;
});
afterAll(() => hubStub.close());

// Fake npm and claude: each logs its arguments and prints what the real one prints.
const PATH = process.env.PATH;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codetgh-upgrade-"));
  const fake = (name: string, out: string) =>
    fakeCommand(
      dir,
      name,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(join(dir, "calls"))}, ${JSON.stringify(name)} + " " + process.argv.slice(2).join(" ") + "\\n");
if (process.env.FAKE_NPM_FAILS && ${JSON.stringify(name)} === "npm") process.exit(1);
${out}`,
    );
  fake("npm", `console.log("changed 1 package in 2s");`);
  fake(
    "claude",
    `const args = process.argv.slice(2).join(" ");
if (args.startsWith("plugin marketplace update")) console.log("Successfully updated marketplace: codetgh");
if (args.startsWith("plugin update")) console.log('Checking for updates for plugin "codetgh@codetgh"…\\n✔ Plugin "codetgh" updated from 0.3.0 to 0.4.0');
if (args === "--version") console.log("2.1.304 (Claude Code)");
if (args === "plugin configure codetgh@codetgh --values-stdin")
  (await import("node:fs")).writeFileSync(${JSON.stringify(join(dir, "options.json"))}, (await import("node:fs")).readFileSync(0));
// Like Claude Code 2.1.304 when the plugin is already off at user scope.
if (args.startsWith("plugin disable") && process.env.FAKE_ALREADY_OFF) {
  console.log(JSON.stringify({ command: "disable", outcome: "failed", failureCode: "already_in_goal_state", alreadyInGoalState: true }));
  process.exit(1);
}`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  process.env.CODETGH_URL = `${hub}/`;
  allowed = ["hooks"];
  process.env.CODETGH_TOKEN = "ctgh_secret_upgrade";
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-upgrade-config-"));
});
afterEach(() => {
  process.env.PATH = PATH;
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_TOKEN;
  delete process.env.FAKE_NPM_FAILS;
  delete process.env.FAKE_ALREADY_OFF;
});

async function upgrade() {
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  const keyring = { get: () => null, set: () => {}, delete: () => {} };
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "upgrade"]);
  return out.join("\n");
}

it("updates the CLI from the hub, then the plugin, and prints what changed", async () => {
  const out = await upgrade();
  expect(readFileSync(join(dir, "calls"), "utf8").trim().split("\n")).toEqual([
    `npm install -g ${hub}/cli/codetgh.tgz`,
    "claude plugin marketplace update codetgh",
    "claude plugin update codetgh@codetgh",
    "claude --version",
    "claude plugin disable codetgh@codetgh --scope user --json",
  ]);
  expect(out).toContain("changed 1 package");
  expect(out).toContain("updated from 0.3.0 to 0.4.0");
  expect(out).toContain("codetgh start");
  expect(out).toContain("an admin can allow rewake in the console Settings");
  expect(existsSync(join(dir, "options.json"))).toBe(false);
  expect(out).not.toContain("ctgh_secret_upgrade");
  expect(readFileSync(join(dir, "calls"), "utf8")).not.toContain("ctgh_secret_upgrade");
});

// Installs from before codetgh start had the plugin on in every session.
it("turns the plugin off at user scope, and takes already off as done", async () => {
  process.env.FAKE_ALREADY_OFF = "1";
  const out = await upgrade();
  expect(readFileSync(join(dir, "calls"), "utf8")).toContain("claude plugin disable codetgh@codetgh --scope user --json");
  expect(out).not.toContain("claude plugin disable");
});

it("sets the rewake push mode when the team allows it, so an idle session wakes up for a message", async () => {
  allowed = ["hooks", "rewake"];
  const out = await upgrade();
  expect(readFileSync(join(dir, "calls"), "utf8")).toContain("claude plugin configure codetgh@codetgh --values-stdin");
  expect(JSON.parse(readFileSync(join(dir, "options.json"), "utf8"))).toEqual({ push_mode: "rewake" });
  expect(out).toContain("push mode rewake");
});

it("stops before the plugin when npm fails, and says what to run", async () => {
  process.env.FAKE_NPM_FAILS = "1";
  await expect(upgrade()).rejects.toThrow(`npm install -g ${hub}/cli/codetgh.tgz`);
  expect(readFileSync(join(dir, "calls"), "utf8")).not.toContain("claude");
});

it("needs a hub to upgrade from", async () => {
  delete process.env.CODETGH_URL;
  await expect(upgrade()).rejects.toThrow("codetgh setup");
});
