import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { fakeCommand } from "../../../e2e/helpers.js";
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
function fakeClaude() {
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
    `import { appendFileSync, existsSync, readFileSync } from "node:fs";
const calls = ${JSON.stringify(join(dir, "calls"))};
const args = process.argv.slice(2).join(" ");
appendFileSync(calls, args + "\\n");
if (args === "--version") console.log("2.1.296 (Claude Code)");
else if (args.startsWith("plugin list"))
  console.log(readFileSync(calls, "utf8").includes("plugin install") ? ${JSON.stringify(listed)} : "[]");
`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  return () => readFileSync(join(dir, "calls"), "utf8");
}

async function setup(answers: Record<string, unknown>, opts: { stdin?: string; keyring?: Map<string, string> } = {}) {
  const store = opts.keyring ?? new Map<string, string>();
  const keyring: Keyring = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) };
  const file = join(mkdtempSync(join(tmpdir(), "codetgh-answers-")), "answers.json");
  writeFileSync(file, JSON.stringify(answers));
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([opts.stdin ?? ""]) };
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-setup-"));
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "setup", "--answers", file, "--token-stdin"]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code, store };
}

describe("codetgh setup from an answers file", () => {
  it("member: connects to the hub, keeps the token in the keychain, installs the plugin, then runs doctor", async () => {
    const calls = fakeClaude();
    const { out, code, store } = await setup(
      { role: "member", hub_url: hub.url, invite_link: "", display_name: "Sam", install_plugin: true },
      { stdin: team.sam.token },
    );
    expect(code).toBe(0);
    expect(store.get(hub.url)).toBe(team.sam.token);
    expect(JSON.parse(readFileSync(join(process.env.CODETGH_CONFIG_DIR ?? "", "config.json"), "utf8"))).toEqual({ url: hub.url });
    expect(calls()).toContain(`plugin marketplace add ${hub.url}/plugin/marketplace.json`);
    expect(calls()).toContain("plugin install codetgh@codetgh");
    expect(out).toContain("ok   token: Sam (@sam, member) in Acme web");
    expect(out).toContain("ok   plugin codetgh@codetgh 0.0.1 enabled");
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
