import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { agent, project, team as teamTable } from "../../../apps/hub/src/db/schema.js";
import { type Hub, setRole, startHub } from "../../../apps/hub/test/harness.js";
import { consolePost, fakeCommand, gitRepo, hookEnv, runHook } from "../../../e2e/helpers.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const PATH = process.env.PATH;
const CWD = process.cwd();
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-doctor-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  process.env.PATH = PATH;
  process.chdir(CWD);
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_STATE_DIR;
});

// A stand-in for the claude binary: its version, the plugin list, the plugin's options and the MCP connection.
function fakeClaude(
  version: string,
  plugins: unknown[],
  opts: { configured: boolean; connected: boolean; pushMode: string; mark?: string } = {
    configured: true,
    connected: true,
    pushMode: "hooks",
  },
) {
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
  console.log(${JSON.stringify(opts.connected)} ? "plugin:codetgh:hub: https://hub/mcp (HTTP) - " + ${JSON.stringify(opts.mark ?? "✔")} + " Connected" : "plugin:codetgh:hub: /mcp (HTTP) - ✘ Failed to connect");
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
  // A port that was just freed: nothing listens there, as with a stopped hub.
  const gone = createServer();
  await new Promise<void>((r) => gone.listen(0, "127.0.0.1", r));
  const stopped = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`;
  await new Promise((r) => gone.close(r));
  const started = Date.now();
  const { out, code } = await doctor(stopped, team.lea.token);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(out).toContain(`FAIL hub unreachable at ${stopped} (ECONNREFUSED)`);
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

it("takes a plugin installed but off as the normal state: codetgh start turns it on per session", async () => {
  fakeClaude("2.1.296", [{ ...installedPlugin(), scope: "user", enabled: false, projectEnabled: false }]);
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("ok   plugin codetgh@codetgh 0.0.1 installed, enabled per session by codetgh start");
  expect(out).not.toContain("warn plugin");
  expect(code).toBe(0);
});

// claude plugin list has no local-scope entry: the user entry reads enabled, as for user scope.
it("does not warn about a plugin the launcher turned on at local scope in this repository", async () => {
  fakeClaude("2.1.296", [{ ...installedPlugin(), scope: "user", enabled: true, projectEnabled: false }]);
  const repo = mkdtempSync(join(tmpdir(), "codetgh-doctor-repo-"));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/settings.local.json"), JSON.stringify({ enabledPlugins: { "codetgh@codetgh": true } }));
  process.chdir(repo);
  const { out } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("ok   plugin codetgh@codetgh 0.0.1 enabled here");
  expect(out).not.toContain("warn plugin");
});

it("warns when the plugin is on at user scope, so in every Claude session on this machine", async () => {
  fakeClaude("2.1.296", [{ ...installedPlugin(), scope: "user", enabled: true, projectEnabled: false }]);
  const { out, code } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("warn plugin codetgh@codetgh is on in every Claude session: claude plugin disable codetgh@codetgh --scope user");
  expect(code).toBe(0);
});

// Claude Code on Windows prints a different check mark in `claude mcp list`.
it("reads Windows' check mark as connected", async () => {
  fakeClaude("2.1.304", [installedPlugin()], { configured: true, connected: true, pushMode: "hooks", mark: "√" });
  const { out } = await doctor(hub.url, team.lea.token);
  expect(out).toContain("ok   hub tools connected in Claude Code");
});

// Seen from a teammate's PC through Tailscale Funnel: every new connection took 2-3 s, more than the hooks' budget.
it("warns when the hub answers too slowly for the hooks, and says how to fix it", async () => {
  fakeClaude("2.1.304", [installedPlugin()]);
  const slow = createServer((req, res) => {
    setTimeout(() => {
      const upstream = request(new URL(req.url ?? "/", hub.url), { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      req.pipe(upstream);
    }, 1800);
  });
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
  const { out } = await doctor(`http://127.0.0.1:${(slow.address() as AddressInfo).port}`, team.lea.token);
  slow.close();
  expect(out).toMatch(/warn hub answers in \d+ ms: too slow for the hooks/);
  expect(out).toMatch(/tailnet/);
});

// The "Sessions" section: what the hub knows of this person's sessions, what this folder's repository is for the hub, and
// what the hooks left in the local state, read together into one line of diagnosis.
const sessionsOf = (out: string) => out.split("\nSessions\n")[1] ?? "";
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const agentId = async (session: string) => (await hub.db.select().from(agent)).find((a) => a.sessionId === session)?.id ?? "";
const projectCount = async () => (await hub.db.select().from(project)).length;
// Runs doctor from `repo`, reading the hook state `env` wrote.
async function doctorIn(repo: string, token: string, stateDir: string) {
  fakeClaude("2.1.296", [installedPlugin()]);
  process.chdir(repo);
  process.env.CODETGH_STATE_DIR = stateDir;
  return doctor(hub.url, token);
}
// An earlier test saved the console settings form without the auto-link box, which turns it off.
const autoLink = async (on: boolean) => {
  const [t] = await hub.db.select().from(teamTable);
  await hub.db.update(teamTable).set({ settings: { ...t?.settings, auto_link_projects: on } });
};
const NOT_FROM_HERE =
  "no session registered from this folder in the last 15 min: Claude was not started with `codetgh start`, or the plugin is not enabled in this session";

it("says all is good when a session started in this folder is registered, with its agent, project, presence and activity", async () => {
  const repo = gitRepo();
  const env = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-doc-ok", source: "startup", cwd: repo }, env);
  await runHook("user-prompt-submit", { session_id: "sam-doc-ok", cwd: repo, prompt: "go" }, env);
  const id = await agentId("sam-doc-ok");
  const { out, code } = await doctorIn(repo, team.sam.token, env.CODETGH_STATE_DIR ?? "");
  const section = sessionsOf(out);
  expect(section).toMatch(new RegExp(`^ok {3}all good: ${short(id)}, acme/webapp, online, in turn for \\d+ s$`, "m"));
  expect(section).toContain(`info hub session ${short(id)} · acme/webapp · online · in turn for`);
  expect(section).toContain("info folder: repository linked to the project acme/webapp");
  expect(section).toContain(`info local: ${short(id)}`);
  expect(section).not.toContain("warn");
  expect(code).toBe(0);
});

it("says no session is registered from this folder when Claude was not started with the plugin on", async () => {
  const repo = gitRepo();
  const { out, code } = await doctorIn(repo, team.lea.token, mkdtempSync(join(tmpdir(), "codetgh-doctor-state-")));
  const section = sessionsOf(out);
  expect(section).toContain(`warn ${NOT_FROM_HERE}`);
  expect(section).toMatch(/→ .*codetgh start/);
  expect(section).toContain("info hub: no live session of yours");
  // A diagnosis is not a failure of the install.
  expect(code).toBe(0);
});

it("never registers a session or links a repository, even where auto-link would apply", async () => {
  await autoLink(true);
  const repo = gitRepo("git@github.com:acme/brand-new.git");
  const projects = await projectCount();
  const agents = (await hub.db.select().from(agent)).length;
  const { out } = await doctorIn(repo, team.lea.token, mkdtempSync(join(tmpdir(), "codetgh-doctor-state-")));
  const section = sessionsOf(out);
  expect(section).toContain("info folder: repository not linked to a project (a session started here would link it)");
  expect(section).toContain(`warn ${NOT_FROM_HERE}`);
  expect(await projectCount()).toBe(projects);
  expect((await hub.db.select().from(agent)).length).toBe(agents);
});

it("tells a folder without a git origin from one the hub does not know", async () => {
  const repo = mkdtempSync(join(tmpdir(), "codetgh-doctor-plain-"));
  execFileSync("git", ["init", "-q", repo]);
  const { out } = await doctorIn(repo, team.lea.token, mkdtempSync(join(tmpdir(), "codetgh-doctor-state-")));
  expect(sessionsOf(out)).toContain("info folder: no git origin, so no project");
});

it("counts the sessions the hub knows when none of them comes from this folder", async () => {
  const state = hookEnv(hub.url, team.malik.token);
  const elsewhere = gitRepo("git@github.com:acme/billing.git");
  for (const session of ["malik-doc-1", "malik-doc-2"])
    await runHook("session-start", { session_id: session, source: "startup", cwd: elsewhere }, state);
  const { out } = await doctorIn(gitRepo(), team.malik.token, mkdtempSync(join(tmpdir(), "codetgh-doctor-state-")));
  expect(sessionsOf(out)).toContain("warn the hub knows 2 sessions of yours, none from this folder");
  expect(sessionsOf(out)).not.toContain(NOT_FROM_HERE);
});

it("names the project a session of this folder is on when it is not the folder's", async () => {
  const repo = gitRepo("git@github.com:acme/api.git");
  const env = hookEnv(hub.url, team.lea.token);
  await runHook("session-start", { session_id: "lea-doc-other", source: "startup", cwd: repo }, env);
  // The repository's origin moved to another project after the session started.
  execFileSync("git", ["-C", repo, "remote", "set-url", "origin", "git@github.com:acme/ops.git"]);
  const { out } = await doctorIn(repo, team.lea.token, env.CODETGH_STATE_DIR ?? "");
  expect(sessionsOf(out)).toContain("warn your session is on another project: acme/api");
  expect(sessionsOf(out)).toContain("info folder: repository linked to the project acme/ops");
});

it("says the repository is not linked when an admin turned auto-link off, and links nothing itself", async () => {
  await autoLink(false);
  const repo = gitRepo("git@github.com:acme/off-limits.git");
  const env = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-doc-off", source: "startup", cwd: repo }, env);
  const before = await projectCount();
  const { out, code } = await doctorIn(repo, team.sam.token, env.CODETGH_STATE_DIR ?? "");
  await autoLink(true);
  const section = sessionsOf(out);
  expect(section).toContain("warn this folder's repository is not linked to a project (admin: auto-link is off)");
  expect(section).toMatch(/→ .*codetgh project new/);
  expect(section).toContain("info local: no agent, unlinked");
  expect(await projectCount()).toBe(before);
  expect(code).toBe(0);
});

it("says in one line that the hub shows no sessions to a guest, and names no project", async () => {
  await setRole(hub, team.malik.userId, "guest");
  const { out, code } = await doctorIn(gitRepo(), team.malik.token, mkdtempSync(join(tmpdir(), "codetgh-doctor-state-")));
  await setRole(hub, team.malik.userId, "member");
  const section = sessionsOf(out);
  expect(section.trim()).toBe("info the hub shows no sessions to a guest");
  expect(section).not.toContain("acme");
  expect(code).toBe(0);
});
