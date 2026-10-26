import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { repoFingerprint } from "@codetgh/shared/repo";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { program, safeGit } from "../src/main.js";

const CWD = process.cwd();
const PATH = process.env.PATH;
const ORIGIN = "git@github.com:acme/webapp.git";
const ZERO = "0".repeat(40);
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
  }).trim();

let repo: string;
let hub: Server | undefined;
let asked: Array<{ auth: string | undefined; body: { repo_fingerprint?: string; paths: string[] } }>;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "codetgh-prepush-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", ORIGIN);
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  process.chdir(repo);
  asked = [];
});
afterEach(() => {
  process.chdir(CWD);
  process.env.PATH = PATH;
  for (const k of ["CODETGH_URL", "CODETGH_TOKEN", "CODETGH_ALLOW_PUSH", "CODETGH_CONFIG_DIR"]) delete process.env[k];
  hub?.closeAllConnections();
  hub?.close();
  hub = undefined;
});

// A hub that answers /v1/claims/check with the holders it is given per path, or never answers.
async function fakeHub(holders: Record<string, Array<{ handle: string; mode: string }>>, behavior: "answer" | "hang" | "fail" = "answer") {
  hub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      asked.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      if (behavior === "hang") return;
      if (behavior === "fail") return void res.writeHead(500).end("{}");
      const paths = (JSON.parse(raw).paths as string[]).map((path) => ({
        path,
        holders: (holders[path] ?? []).map((h, i) => ({ claim_id: `clm_${i}`, name: h.handle, remaining_min: 20, ...h })),
        recent: [],
      }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ paths }));
    });
  });
  const server = hub;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CODETGH_URL = url;
  process.env.CODETGH_TOKEN = "ctgh_test";
  return url;
}

async function cli(args: string[], stdin = "") {
  const lines: string[] = [];
  const io = { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s), stdin: Readable.from([stdin]) };
  process.exitCode = 0;
  const started = Date.now();
  await program({ keyring: async () => ({ get: () => null, set() {}, delete() {} }), io }).parseAsync(["node", "codetgh", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: lines.join("\n"), code, ms: Date.now() - started };
}

// A push of branch `feature` carrying the files given, as git's pre-push hook describes it on stdin.
function feature(files: string[], remoteSha = ZERO) {
  git(repo, "checkout", "-q", "-b", "feature");
  for (const f of files) {
    mkdirSync(join(repo, f, ".."), { recursive: true });
    writeFileSync(join(repo, f), `${f}\n`);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "work");
  return `refs/heads/feature ${git(repo, "rev-parse", "HEAD")} refs/heads/feature ${remoteSha}\n`;
}

describe("codetgh claims check-push", () => {
  it("lists the pushed files that someone else claims, asks the hub about the repository, and exits 1", async () => {
    await fakeHub({ "src/api.ts": [{ handle: "lea", mode: "exclusive" }] });
    const refs = feature(["src/api.ts", "src/free.ts"]);
    const r = await cli(["claims", "check-push", "origin", ORIGIN], refs);
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/api.ts");
    expect(r.out).toContain("@lea");
    expect(r.out).toContain("exclusive");
    expect(r.out).not.toContain("src/free.ts");
    expect(r.out).toContain("CODETGH_ALLOW_PUSH=1");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.auth).toBe("Bearer ctgh_test");
    expect(asked[0]?.body.repo_fingerprint).toBe(repoFingerprint(ORIGIN));
    expect(asked[0]?.body.paths.sort()).toEqual(["src/api.ts", "src/free.ts"]);
  });

  it("looks at what the push adds to a branch the remote already has, not at the whole branch", async () => {
    await fakeHub({ "old.ts": [{ handle: "lea", mode: "exclusive" }], "new.ts": [{ handle: "sam", mode: "intent" }] });
    git(repo, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repo, "old.ts"), "old\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "first push");
    const remote = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "new.ts"), "new\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "second push");
    const r = await cli(["claims", "check-push"], `refs/heads/feature ${git(repo, "rev-parse", "HEAD")} refs/heads/feature ${remote}\n`);
    expect(asked[0]?.body.paths).toEqual(["new.ts"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("new.ts");
    expect(r.out).toContain("@sam");
    expect(r.out).not.toContain("old.ts");
  });

  it("lets a push through when nothing it carries is claimed, or the claim is only a shared one", async () => {
    await fakeHub({ "docs/a.md": [{ handle: "lea", mode: "shared" }] });
    const refs = feature(["docs/a.md", "docs/b.md"]);
    const r = await cli(["claims", "check-push"], refs);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  it("skips deleted branches and refs that are not branches", async () => {
    await fakeHub({});
    const tip = git(repo, "rev-parse", "HEAD");
    const r = await cli(["claims", "check-push"], `(delete) ${ZERO} refs/heads/old ${tip}\nrefs/tags/v1 ${tip} refs/tags/v1 ${ZERO}\n`);
    expect(r.code).toBe(0);
    expect(asked).toEqual([]);
  });

  it("lets everything through with CODETGH_ALLOW_PUSH=1, without asking the hub", async () => {
    await fakeHub({ "src/api.ts": [{ handle: "lea", mode: "exclusive" }] });
    process.env.CODETGH_ALLOW_PUSH = "1";
    const r = await cli(["claims", "check-push"], feature(["src/api.ts"]));
    expect(r.code).toBe(0);
    expect(asked).toEqual([]);
  });

  it("fails open with one warning when the hub is unreachable, refuses, or has no token", async () => {
    const refs = feature(["src/api.ts"]);
    process.env.CODETGH_URL = "http://127.0.0.1:9";
    process.env.CODETGH_TOKEN = "ctgh_test";
    const down = await cli(["claims", "check-push"], refs);
    expect(down.code).toBe(0);
    expect(down.out.split("\n")).toHaveLength(1);
    expect(down.out).toMatch(/^codetgh: claims not checked/);

    await fakeHub({}, "fail");
    const broken = await cli(["claims", "check-push"], refs);
    expect(broken.code).toBe(0);
    expect(broken.out.split("\n")).toHaveLength(1);

    delete process.env.CODETGH_TOKEN;
    process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-nocfg-"));
    const anon = await cli(["claims", "check-push"], refs);
    expect(anon.code).toBe(0);
    expect(anon.out).toMatch(/^codetgh: claims not checked/);
  });

  it("gives up after 3 seconds on a hub that never answers", async () => {
    await fakeHub({}, "hang");
    const r = await cli(["claims", "check-push"], feature(["src/api.ts"]));
    expect(r.code).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(2900);
    expect(r.ms).toBeLessThan(5000);
    expect(r.out).toMatch(/^codetgh: claims not checked/);
  });

  it("passes when the repository has no default branch to compare a new branch with", async () => {
    await fakeHub({ "src/api.ts": [{ handle: "lea", mode: "exclusive" }] });
    const refs = feature(["src/api.ts"]);
    git(repo, "update-ref", "-d", "refs/remotes/origin/main");
    const r = await cli(["claims", "check-push"], refs);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^codetgh: claims not checked/);
  });
});

const SIGNATURE = "# codetgh:pre-push";
const hookPath = () => join(repo, ".git/hooks/pre-push");

describe("codetgh hooks install", () => {
  it.skipIf(process.platform === "win32")("writes an executable, signed pre-push hook that calls check-push", async () => {
    const r = await cli(["hooks", "install"]);
    expect(r.out).toContain(".git/hooks/pre-push");
    const script = readFileSync(hookPath(), "utf8");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(SIGNATURE);
    expect(script).toContain("codetgh claims check-push");
    expect(statSync(hookPath()).mode & 0o111).not.toBe(0);
    // Again: it replaces its own file without --force.
    expect((await cli(["hooks", "install"])).code).toBe(0);
  });

  it("never overwrites a pre-push hook of someone else, unless --force", async () => {
    mkdirSync(join(repo, ".git/hooks"), { recursive: true });
    writeFileSync(hookPath(), "#!/bin/sh\necho mine\n");
    await expect(cli(["hooks", "install"])).rejects.toThrow(/not CodeTgh's/);
    expect(readFileSync(hookPath(), "utf8")).toBe("#!/bin/sh\necho mine\n");
    expect((await cli(["hooks", "uninstall"])).out).toMatch(/not CodeTgh's/);
    expect(existsSync(hookPath())).toBe(true);
    await cli(["hooks", "install", "--force"]);
    expect(readFileSync(hookPath(), "utf8")).toContain(SIGNATURE);
  });

  it("uninstalls its own hook only", async () => {
    expect((await cli(["hooks", "uninstall"])).out).toMatch(/no CodeTgh pre-push hook/);
    await cli(["hooks", "install"]);
    await cli(["hooks", "uninstall"]);
    expect(existsSync(hookPath())).toBe(false);
  });

  it("writes where core.hooksPath points", async () => {
    git(repo, "config", "core.hooksPath", ".githooks");
    await cli(["hooks", "install"]);
    expect(readFileSync(join(repo, ".githooks/pre-push"), "utf8")).toContain(SIGNATURE);
    expect(existsSync(hookPath())).toBe(false);
    await cli(["hooks", "uninstall"]);
    expect(existsSync(join(repo, ".githooks/pre-push"))).toBe(false);
  });

  it("refuses outside a git repository", async () => {
    process.chdir(mkdtempSync(join(tmpdir(), "codetgh-norepo-")));
    await expect(cli(["hooks", "install"])).rejects.toThrow(/git repository/);
  });
});

describe.skipIf(process.platform === "win32")("the installed hook", () => {
  // A `codetgh` on PATH that records its arguments and what git sent it, then answers with `code`.
  function fakeCodetgh(code: number) {
    const dir = mkdtempSync(join(tmpdir(), "codetgh-shim-"));
    const log = join(dir, "log");
    writeFileSync(join(dir, "codetgh"), `#!/bin/sh\necho "$@" > "${log}"\ncat >> "${log}"\nexit ${code}\n`);
    chmodSync(join(dir, "codetgh"), 0o755);
    process.env.PATH = `${dir}${delimiter}${PATH}`;
    return log;
  }
  function remote() {
    const bare = mkdtempSync(join(tmpdir(), "codetgh-bare-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: bare });
    git(repo, "remote", "set-url", "origin", bare);
    return bare;
  }

  it("passes its arguments and the refs git sends on stdin to codetgh claims check-push", async () => {
    await cli(["hooks", "install"]);
    const log = fakeCodetgh(0);
    remote();
    git(repo, "push", "-q", "origin", "main");
    const [args, refs] = readFileSync(log, "utf8").split("\n");
    expect(args).toMatch(/^claims check-push origin /);
    expect(refs).toMatch(new RegExp(`^refs/heads/main ${git(repo, "rev-parse", "HEAD")} refs/heads/main ${ZERO}$`));
  });

  it("refuses the push when check-push exits 1, and lets it through with --no-verify", async () => {
    await cli(["hooks", "install"]);
    fakeCodetgh(1);
    const bare = remote();
    expect(() => git(repo, "push", "-q", "origin", "main")).toThrow();
    expect(execFileSync("git", ["for-each-ref", "refs/heads"], { cwd: bare, encoding: "utf8" })).toBe("");
    git(repo, "push", "-q", "--no-verify", "origin", "main");
    expect(execFileSync("git", ["for-each-ref", "refs/heads"], { cwd: bare, encoding: "utf8" })).toContain("refs/heads/main");
  });

  it("does not stand in the way when codetgh is not installed", async () => {
    await cli(["hooks", "install"]);
    remote();
    const sh = spawnSync("sh", ["-c", `PATH=/usr/bin:/bin; ${hookPath()} origin x < /dev/null`], { cwd: repo });
    expect(sh.status).toBe(0);
  });

  it("does not run for the runner's own git calls, with or without --no-verify", async () => {
    await cli(["hooks", "install"]);
    fakeCodetgh(1);
    const bare = remote();
    await safeGit(["-C", repo, "push", "-q", "origin", "main:refs/heads/viaRunner"]);
    await safeGit(["-C", repo, "push", "-q", "--no-verify", "origin", "main:refs/heads/viaRunnerNoVerify"]);
    const heads = execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/heads"], { cwd: bare, encoding: "utf8" });
    expect(heads.split("\n").sort()).toEqual(["", "refs/heads/viaRunner", "refs/heads/viaRunnerNoVerify"]);
  });
});
