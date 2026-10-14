import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { project } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { type Keyring, program } from "../packages/cli/src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const PATH = process.env.PATH;
const CWD = process.cwd();
beforeAll(async () => {
  const distDir = mkdtempSync(join(tmpdir(), "codetgh-dist-"));
  writeFileSync(join(distDir, "plugin.zip"), zipSync({ "codetgh/.claude-plugin/plugin.json": strToU8("{}") }));
  hub = await startHub({ config: { distDir } });
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-project-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  process.env.PATH = PATH;
  process.chdir(CWD);
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_TOKEN;
});

// claude plugin validate passes or fails on demand; the marketplace it was given is kept for the test to read.
function fakeClaude(validates: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "$1 $2" = "plugin validate" ]; then cp "$3/.claude-plugin/marketplace.json" "${dir}/validated.json"; ${validates ? "echo '✔ Validation passed'; exit 0" : "echo '✘ Validation failed'; exit 1"}; fi\nexit 1\n`,
  );
  chmodSync(bin, 0o755);
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  return dir;
}
function repo(origin: string) {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir });
  process.chdir(dir);
  return dir;
}
async function cli(args: string[]) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = team.lea.token;
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

describe("codetgh project new", () => {
  it("creates the project, declares the hub's marketplace and prints the invitation message", async () => {
    const validated = fakeClaude(true);
    const dir = repo("git@github.com:Acme/Billing.git");
    writeFileSync(join(dir, "CLAUDE.md"), "# Billing\n\nOur rules.\n");
    execFileSync("mkdir", ["-p", join(dir, ".claude")]);
    writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(pnpm test)"] } }));

    const { out, code } = await cli(["project", "new", "Billing"]);
    expect(code).toBe(0);
    const [row] = await hub.db
      .select()
      .from(project)
      .where(eq(project.repoFingerprint, repoFingerprint("git@github.com:Acme/Billing.git")));
    expect(row?.name).toBe("Billing");

    const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    expect(settings).toEqual({
      permissions: { allow: ["Bash(pnpm test)"] },
      extraKnownMarketplaces: { codetgh: { source: { source: "url", url: `${hub.url}/plugin/marketplace.json` } } },
      enabledPlugins: { "codetgh@codetgh": true },
    });
    expect(JSON.parse(readFileSync(join(validated, "validated.json"), "utf8")).name).toBe("codetgh");
    const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(md.startsWith("# Billing\n\nOur rules.\n")).toBe(true);
    expect(md).toContain("<!-- codetgh -->");
    expect(out).toContain(`npm install -g ${hub.url}/cli/codetgh.tgz`);
    expect(out).toContain("codetgh setup");
    expect(out).not.toContain(team.lea.token);

    // Running it again changes nothing twice.
    await cli(["project", "new", "Billing"]);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(md);
  });

  it("prints the manual plugin commands instead when the marketplace does not validate", async () => {
    fakeClaude(false);
    const dir = repo("https://github.com/acme/ops.git");
    const { out, code } = await cli(["project", "new", "Ops"]);
    expect(code).toBe(0);
    expect(() => readFileSync(join(dir, ".claude/settings.json"))).toThrow();
    expect(out).toContain(`claude plugin marketplace add ${hub.url}/plugin/marketplace.json`);
    expect(out).toContain("claude plugin install codetgh@codetgh");
  });

  it("needs a git repository with an origin", async () => {
    fakeClaude(true);
    process.chdir(mkdtempSync(join(tmpdir(), "codetgh-norepo-")));
    await expect(cli(["project", "new", "Nowhere"])).rejects.toThrow(/git remote add origin/);
  });

  it("keeps the project's name when sessions start in it", async () => {
    const fp = repoFingerprint("git@github.com:Acme/Billing.git");
    await startSession(hub.url, team.sam.token, "sam-billing", { repo: fp });
    const [row] = await hub.db.select().from(project).where(eq(project.repoFingerprint, fp));
    expect(row?.name).toBe("Billing");
  });
});
