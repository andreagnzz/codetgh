import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { type Keyring, program } from "../packages/cli/src/main.js";

const ORIGIN = "git@github.com:acme/webapp.git";
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const CWD = process.cwd();
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-prepush-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  process.chdir(CWD);
  for (const k of ["CODETGH_URL", "CODETGH_TOKEN", "CODETGH_ALLOW_PUSH"]) delete process.env[k];
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
  }).trim();

// A clone of the team's repository with a branch that touches the given files, and the pre-push line git would send.
function branch(files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-push-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", ORIGIN);
  writeFileSync(join(dir, "README.md"), "hi\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "checkout", "-q", "-b", "feature");
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), `${f}\n`);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "work");
  process.chdir(dir);
  return `refs/heads/feature ${git(dir, "rev-parse", "HEAD")} refs/heads/feature ${"0".repeat(40)}\n`;
}

async function checkPush(token: string, refs: string, url = hub.url) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([refs]) };
  process.env.CODETGH_URL = url;
  process.env.CODETGH_TOKEN = token;
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "claims", "check-push"]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

describe("codetgh claims check-push against a hub", () => {
  it("refuses a push that carries a file another person claims, not one that session or person claims", async () => {
    const fingerprint = repoFingerprint(ORIGIN);
    const lea1 = (await startSession(hub.url, team.lea.token, "lea-push-1", { repo: fingerprint })).agent_id ?? "";
    const lea2 = (await startSession(hub.url, team.lea.token, "lea-push-2", { repo: fingerprint })).agent_id ?? "";
    const lea = await mcpClient(hub.url, team.lea.token);
    const sam = await mcpClient(hub.url, team.sam.token);
    await call(lea, "claim", { agent: lea1, scope: ["src/api.ts"], reason: "contract rewrite" });
    await call(sam, "claim", {
      scope: ["src/web.ts"],
      agent: (await startSession(hub.url, team.sam.token, "sam-push", { repo: fingerprint })).agent_id,
    });

    const refs = branch(["src/api.ts", "src/web.ts", "src/free.ts"]);
    // Sam pushes: Léa's file stops the push, his own file does not.
    const asSam = await checkPush(team.sam.token, refs);
    expect(asSam.code).toBe(1);
    expect(asSam.out).toContain("src/api.ts");
    expect(asSam.out).toContain("@lea");
    expect(asSam.out).not.toContain("src/web.ts");
    expect(asSam.out).not.toContain("src/free.ts");
    // The reason is a peer's words: never printed.
    expect(asSam.out).not.toContain("contract rewrite");

    // Léa pushes from her second session: her other session's claim is hers, Sam's file is not.
    expect(lea2).not.toBe(lea1);
    const asLea = await checkPush(team.lea.token, refs);
    expect(asLea.code).toBe(1);
    expect(asLea.out).toContain("src/web.ts");
    expect(asLea.out).not.toContain("src/api.ts");

    // Released: nothing stands in the way.
    await call(lea, "claim_release", { agent: lea1, all_mine: true });
    expect((await checkPush(team.sam.token, refs)).code).toBe(0);
    await lea.close();
    await sam.close();
  });

  it("lets the push through with CODETGH_ALLOW_PUSH=1, and when the hub is down", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const agent = (await startSession(hub.url, team.lea.token, "lea-push-3", { repo: repoFingerprint(ORIGIN) })).agent_id;
    await call(lea, "claim", { agent, scope: ["src/held.ts"] });
    const refs = branch(["src/held.ts"]);
    expect((await checkPush(team.sam.token, refs)).code).toBe(1);
    process.env.CODETGH_ALLOW_PUSH = "1";
    expect((await checkPush(team.sam.token, refs)).code).toBe(0);
    delete process.env.CODETGH_ALLOW_PUSH;
    const down = await checkPush(team.sam.token, refs, "http://127.0.0.1:9");
    expect(down.code).toBe(0);
    expect(down.out).toMatch(/^codetgh: claims not checked/);
    await lea.close();
  });
});
