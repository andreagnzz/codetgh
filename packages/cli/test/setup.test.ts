import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { consolePost, fakeCommand } from "../../../e2e/helpers.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const PATH = process.env.PATH;
const CWD = process.cwd();
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());
afterEach(() => {
  process.env.PATH = PATH;
  process.chdir(CWD);
});

// A fake claude: records its arguments, and lists the plugin as installed once "plugin install" ran.
function fakeClaude(version = "2.1.296") {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  const plugin = join(dir, "plugin");
  mkdirSync(join(plugin, "dist"), { recursive: true });
  mkdirSync(join(plugin, "hooks"));
  writeFileSync(join(plugin, "dist/hook.js"), "");
  writeFileSync(join(plugin, "hooks/hooks.json"), "{}");
  const listed = JSON.stringify([{ id: "codetgh@codetgh", version: "0.0.1", enabled: true, installPath: plugin }]);
  fakeCommand(
    dir,
    "claude",
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const calls = ${JSON.stringify(join(dir, "calls"))};
const options = ${JSON.stringify(join(dir, "options.json"))};
const args = process.argv.slice(2).join(" ");
appendFileSync(calls, args + "\\n");
// Like Claude Code: adding the marketplace declares it in the user settings.
if (args.startsWith("plugin marketplace add") || args.includes("--marketplace")) {
  const settings = join(process.env.CLAUDE_CONFIG_DIR, "settings.json");
  const url = process.argv[process.argv.indexOf(args.includes("--marketplace") ? "--marketplace" : "add") + 1];
  writeFileSync(settings, JSON.stringify({ theme: "dark", extraKnownMarketplaces: { codetgh: { source: { source: "url", url } } } }));
}
const saved = () => (existsSync(options) ? JSON.parse(readFileSync(options, "utf8")) : {});
// Like Claude Code: each call saves the options it is given and keeps the others.
if (args === "plugin configure codetgh@codetgh --values-stdin")
  writeFileSync(options, JSON.stringify({ ...saved(), ...JSON.parse(readFileSync(0, "utf8")) }));
if (args.startsWith("plugin install") && args.includes("--config")) {
  const argv = process.argv.slice(2);
  const set = argv.flatMap((a, i) => (argv[i - 1] === "--config" ? [a.split(/=(.*)/s).slice(0, 2)] : []));
  writeFileSync(options, JSON.stringify({ ...saved(), ...Object.fromEntries(set) }));
}
if (args === "plugin configure codetgh@codetgh --json")
  console.log(JSON.stringify(existsSync(options) ? { configured: ["codetgh_url", "codetgh_token"], unconfigured: [] } : { configured: [], unconfigured: ["codetgh_url"] }));
if (args === "mcp list") console.log(existsSync(options) ? "plugin:codetgh:hub: /mcp (HTTP) - ✔ Connected" : "plugin:codetgh:hub: /mcp (HTTP) - ✘ Failed to connect");
if (args === "--version") console.log(${JSON.stringify(version)} + " (Claude Code)");
else if (args.startsWith("plugin list"))
  console.log(readFileSync(calls, "utf8").includes("plugin install") ? ${JSON.stringify(listed)} : "[]");
`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  return Object.assign(() => readFileSync(join(dir, "calls"), "utf8"), {
    options: () => JSON.parse(readFileSync(join(dir, "options.json"), "utf8")),
  });
}

async function setup(answers: Record<string, unknown>, opts: { stdin?: string; keyring?: Map<string, string> } = {}) {
  const store = opts.keyring ?? new Map<string, string>();
  const keyring: Keyring = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) };
  const file = join(mkdtempSync(join(tmpdir(), "codetgh-answers-")), "answers.json");
  writeFileSync(file, JSON.stringify(answers));
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([opts.stdin ?? ""]) };
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-setup-"));
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-claude-config-"));
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "setup", "--answers", file, "--token-stdin"]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code, store };
}

describe("codetgh setup from an answers file", () => {
  it("member: picks the rewake push mode on its own when the team allows it", async () => {
    await consolePost(hub.url, team.lea.cookie, "/console/settings", {
      retention_days: "90",
      secret_patterns: "",
      push_hooks: "on",
      push_rewake: "on",
    });
    const calls = fakeClaude();
    const { out } = await setup(
      { role: "member", hub_url: hub.url, invite_link: "", display_name: "Malik", install_plugin: true },
      { stdin: team.malik.token },
    );
    expect(calls.options().push_mode).toBe("rewake");
    expect(out).toContain("push mode rewake");
    await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "", push_hooks: "on" });
  });

  it("member: connects to the hub, keeps the token in the keychain, installs the plugin, then runs doctor", async () => {
    // Before 2.1.292: marketplace add, install, then configure through stdin.
    const calls = fakeClaude("2.1.280");
    const { out, code, store } = await setup(
      { role: "member", hub_url: hub.url, invite_link: "", display_name: "Sam", install_plugin: true },
      { stdin: team.sam.token },
    );
    expect(code).toBe(0);
    expect(store.get(hub.url)).toBe(team.sam.token);
    expect(JSON.parse(readFileSync(join(process.env.CODETGH_CONFIG_DIR ?? "", "config.json"), "utf8"))).toEqual({ url: hub.url });
    expect(calls()).toContain(`plugin marketplace add ${hub.url}/plugin/marketplace.json`);
    expect(
      JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? "", "settings.json"), "utf8")).extraKnownMarketplaces.codetgh
        .autoUpdate,
    ).toBe(true);
    expect(calls()).toContain("plugin install codetgh@codetgh");
    // Off everywhere by default: project new turns it on in the team repositories only.
    expect(calls()).toContain("plugin disable codetgh@codetgh --scope user");
    expect(out).toContain("ok   token: Sam (@sam, member) in Acme web");
    expect(out).toContain("ok   plugin codetgh@codetgh 0.0.1 enabled");
    // The plugin gets the hub URL and the token through stdin, never through its arguments.
    expect(calls()).toContain("plugin configure codetgh@codetgh --values-stdin");
    expect(calls.options()).toEqual({ codetgh_url: hub.url, codetgh_token: team.sam.token, push_mode: "hooks" });
    expect(calls()).not.toContain(team.sam.token);
    expect(out).toContain("ok   plugin options: hub URL and token set");
    expect(out).toContain("restart Claude Code");
    expect(out).toContain("older than 2.1.292");
    expect(out).not.toContain(team.sam.token);
  });

  it("member: on Claude Code 2.1.292 or later, installs the plugin in one claude command, the token through stdin", async () => {
    const calls = fakeClaude("2.1.301");
    const { out, code } = await setup(
      { role: "member", hub_url: hub.url, invite_link: "", display_name: "Sam", install_plugin: true },
      { stdin: team.sam.token },
    );
    expect(code).toBe(0);
    const installs = calls()
      .split("\n")
      .filter((l) => l.startsWith("plugin install"));
    expect(installs).toEqual([
      `plugin install codetgh --marketplace ${hub.url}/plugin/marketplace.json --scope user -y --config codetgh_url=${hub.url} --config push_mode=hooks`,
    ]);
    expect(calls()).not.toContain("plugin marketplace add");
    // Third-party marketplaces do not auto-update by default: setup turns it on in the entry Claude Code declared.
    expect(JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? "", "settings.json"), "utf8"))).toEqual({
      theme: "dark",
      extraKnownMarketplaces: { codetgh: { source: { source: "url", url: `${hub.url}/plugin/marketplace.json` }, autoUpdate: true } },
    });
    expect(calls()).toContain("plugin disable codetgh@codetgh --scope user");
    // The token reaches the plugin through configure's stdin, never through any argument: argv shows in ps.
    expect(calls()).toContain("plugin configure codetgh@codetgh --values-stdin");
    expect(calls()).not.toContain(team.sam.token);
    expect(calls.options()).toEqual({ codetgh_url: hub.url, push_mode: "hooks", codetgh_token: team.sam.token });
    expect(out).toContain("ok   plugin options: hub URL and token set");
    expect(out).not.toContain(team.sam.token);
  });

  it("member: opens the invitation with the display name filled in", async () => {
    fakeClaude();
    const link = `${hub.url}/invite/abc123`;
    const { out } = await setup(
      { role: "member", hub_url: hub.url, invite_link: link, display_name: "Nina Ro", install_plugin: false },
      { stdin: team.sam.token },
    );
    expect(out).toContain(`${link}?name=Nina%20Ro`);
  });

  it("member: stops at an unreachable hub with the cause and the fix, before asking for a token", async () => {
    fakeClaude();
    await expect(setup({ role: "member", hub_url: "http://127.0.0.1:9", display_name: "Sam" })).rejects.toThrow(
      /cannot reach http:\/\/127\.0\.0\.1:9.*(address|admin)/,
    );
  });

  it("member: says what goes in the invitation field when it gets something else, like an email", async () => {
    fakeClaude();
    await expect(setup({ role: "member", hub_url: hub.url, invite_link: "lea@acme.test", display_name: "Léa" })).rejects.toThrow(
      /not an invitation link: paste the .*\/invite\/.* link from the email, or leave it empty if you already have an account/,
    );
    await expect(
      setup({ role: "member", hub_url: hub.url, invite_link: "https://other.example/invite/abc", display_name: "Léa" }),
    ).rejects.toThrow(/this invitation is not for/);
  });

  it("admin: writes deploy/.env with generated secrets it never prints, and the commands to start the hub", async () => {
    fakeClaude();
    const repo = mkdtempSync(join(tmpdir(), "codetgh-clone-"));
    mkdirSync(join(repo, "deploy"));
    writeFileSync(join(repo, "deploy/compose.yaml"), "services: {}\n");
    writeFileSync(join(repo, "deploy/.env.example"), readFileSync(join(CWD, "deploy/.env.example")));
    process.chdir(repo);
    const answers = {
      role: "admin",
      hub_location: "this-machine",
      sign_in: "github",
      public_access: "domain",
      public_url: "https://codetgh.acme.test",
      team: "Acme web",
      project: "webapp",
      email: "lea@acme.test",
      start: false,
    };
    const { out } = await setup(answers);
    const env = readFileSync(join(repo, "deploy/.env"), "utf8");
    // Windows has no POSIX file modes.
    if (process.platform !== "win32") expect(statSync(join(repo, "deploy/.env")).mode & 0o777).toBe(0o600);
    const secret = env.match(/^CODETGH_SECRET=(.+)$/m)?.[1] ?? "";
    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(env).toMatch(/^POSTGRES_PASSWORD=.{20,}$/m);
    expect(env).toContain("CODETGH_PUBLIC_URL=https://codetgh.acme.test");
    expect(out).not.toContain(secret);
    expect(out).toContain("docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build");
    expect(out).toContain('bootstrap.js --team "Acme web" --email lea@acme.test');
    expect(out).toContain("https://codetgh.acme.test/api/auth/callback/github");
    expect(out).toContain("AUTH_GITHUB_ID");
    expect(out).toContain("codetgh project new webapp");

    // A second run keeps the secrets already there.
    await setup(answers);
    expect(readFileSync(join(repo, "deploy/.env"), "utf8").match(/^CODETGH_SECRET=(.+)$/m)?.[1]).toBe(secret);
  });

  it("refuses a token written in the answers file, and names a missing answer", async () => {
    await expect(setup({ role: "member", hub_url: hub.url, token: "ctgh_x" })).rejects.toThrow(/never put a token/);
    await expect(setup({ role: "admin", hub_location: "this-machine" })).rejects.toThrow(/the answers file has no "email"/);
  });
});
