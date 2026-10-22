import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { repoFingerprint } from "@codetgh/shared/repo";
import { RoutingRules } from "@codetgh/shared/rest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { project, task } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { newId } from "../apps/hub/src/ids.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { type Keyring, program, runnerTiming } from "../packages/cli/src/main.js";
import { consolePost, fakeCommand, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let projectId = "";
let agentId = "";
let root = "";
let origin = "";
let clone = "";
let fake = "";
const PATH = process.env.PATH;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }).trim();

// A fake claude: records argv, cwd, env and stdin, then acts on the task title it reads on stdin.
// A fake gh: records argv and prints a PR URL with a growing number.
function fakes() {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-runner-"));
  fakeCommand(
    dir,
    "claude",
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const dir = ${JSON.stringify(dir)};
const stdin = readFileSync(0, "utf8");
appendFileSync(join(dir, "claude.jsonl"), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), runner: process.env.CODETGH_RUNNER ?? null, accept: process.env.CODETGH_ACCEPT_REQUESTS_FROM ?? null, stdin }) + "\\n");
if (stdin.includes("FAIL")) {
  console.log("a line only the local log may hold");
  process.exit(1);
}
if (stdin.includes("TAMPER")) execFileSync("git", ["config", "alias.x", "!touch pwned"]);
if (stdin.includes("SLEEP")) {
  writeFileSync(join(dir, "pid"), String(process.pid));
  setTimeout(() => {}, 300_000);
} else {
  if (!stdin.includes("NOCOMMIT")) {
    writeFileSync("work.txt", stdin.length + "\\n");
    execFileSync("git", ["add", "work.txt"]);
    execFileSync("git", ["-c", "user.name=agent", "-c", "user.email=agent@example.com", "commit", "-q", "-m", "Do the task"]);
  }
  console.log(JSON.stringify({ type: "result", is_error: false, result: "done" }));
}
`,
  );
  fakeCommand(
    dir,
    "gh",
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = ${JSON.stringify(dir)};
appendFileSync(join(dir, "gh.jsonl"), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (process.argv[2] === "pr" && process.argv[3] === "create") {
  const n = existsSync(join(dir, "n")) ? Number(readFileSync(join(dir, "n"), "utf8")) + 1 : 1;
  writeFileSync(join(dir, "n"), String(n));
  console.log("https://github.com/acme/webapp/pull/" + n);
}
`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  return dir;
}
const lines = (file: string) =>
  existsSync(join(fake, file))
    ? readFileSync(join(fake, file), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];

beforeAll(async () => {
  // Every test creates tasks: a clock that jumps an hour per call keeps the write quota out of the way.
  let now = 0;
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  // A bare "origin" with one commit on main, and the clone the runner works in.
  root = mkdtempSync(join(tmpdir(), "codetgh-runner-git-"));
  origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(root, "seed");
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  writeFileSync(join(seed, "README.md"), "hello\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "First commit");
  git(seed, "push", "-q", origin, "main");
  clone = join(root, "clone");
  execFileSync("git", ["clone", "-q", origin, clone]);
  // The routing table lives on the default branch.
  mkdirSync(join(seed, ".codetgh"));
  writeFileSync(
    join(seed, ".codetgh/routing.json"),
    JSON.stringify({
      rules: [
        { match: { role: "reviewer" }, model: "opus" },
        { match: { role: "author" }, model: "sonnet", effort: "low" },
      ],
    }),
  );
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "Add routing");
  git(seed, "push", "-q", origin, "main");
  const fingerprint = repoFingerprint(origin);
  projectId = newId("prj");
  await hub.db.insert(project).values({ id: projectId, teamId: team.teamId, name: "acme/runner", repoFingerprint: fingerprint });
  agentId = (await startSession(hub.url, team.lea.token, "lea-runner", { repo: fingerprint })).agent_id ?? "";
  expect((await consolePost(hub.url, team.lea.cookie, `/console/projects/${projectId}/runner`, { on: "1" })).status).toBe(204);
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-runner-cfg-"));
  fake = fakes();
});
afterEach(async () => {
  // Leftover queue entries would be picked up by the next test.
  await hub.db
    .update(task)
    .set({ status: "cancelled", leaseOwner: null, leaseUntil: null })
    .where(and(eq(task.projectId, projectId), eq(task.status, "todo")));
  rmSync(join(fake, "pid"), { force: true });
});
afterAll(async () => {
  process.env.PATH = PATH;
  await hub.stop();
});

// Created by Léa's agent (the owner), as /codetgh:split --run would.
async function create(title: string, args: Record<string, unknown> = {}) {
  const lea = await mcpClient(hub.url, team.lea.token);
  const r = await call(lea, "task_create", { agent: agentId, title, body: `Done when ${title} works.`, runner: true, ...args });
  await lea.close();
  if (r.isError) throw new Error(r.text);
  return (JSON.parse(r.text) as { id: string }).id;
}
const row = async (id: string) => (await hub.db.select().from(task).where(eq(task.id, id)))[0];
const slug = (id: string) => id.toLowerCase();
const worktree = (id: string) => join(process.env.CODETGH_CONFIG_DIR ?? "", "worktrees", projectId, slug(id));
const onOrigin = (id: string) => {
  try {
    return git(origin, "rev-parse", "--verify", "-q", `codetgh/${slug(id)}`);
  } catch {
    return "";
  }
};

function writeConfig(cfg: Record<string, unknown>) {
  const file = join(mkdtempSync(join(tmpdir(), "codetgh-runner-json-")), "runner.json");
  writeFileSync(file, JSON.stringify({ projects: { [projectId]: clone }, ...cfg }));
  return file;
}
async function runner(cfg: Record<string, unknown> = {}) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = team.lea.token;
  try {
    await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "runner", "--config", writeConfig(cfg), "--once"]);
  } finally {
    delete process.env.CODETGH_URL;
    delete process.env.CODETGH_TOKEN;
  }
  return out.join("\n");
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitForPid() {
  for (let i = 0; i < 200 && !existsSync(join(fake, "pid")); i++) await sleep(25);
  return Number(readFileSync(join(fake, "pid"), "utf8"));
}

describe("codetgh runner", () => {
  let parent = "";

  it("takes a ready task through a worktree, the agent, a push and a PR on main, then puts it in review", async () => {
    // A routing file in the checkout is not the default branch's: ignored.
    mkdirSync(join(clone, ".codetgh"), { recursive: true });
    writeFileSync(join(clone, ".codetgh/routing.json"), JSON.stringify({ rules: [{ match: { role: "author" }, model: "opus" }] }));
    parent = await create("plain");
    await runner();
    const wt = worktree(parent);
    expect(existsSync(join(wt, "work.txt"))).toBe(true);
    expect(onOrigin(parent)).toMatch(/^[0-9a-f]{40}$/);

    const [agent] = lines("claude.jsonl");
    expect(agent.cwd).toBe(wt);
    expect(agent.argv.slice(0, 1)).toEqual(["-p"]);
    expect(agent.argv).toEqual(expect.arrayContaining(["--permission-mode", "auto", "--output-format", "json"]));
    expect(agent.argv.join(" ")).not.toMatch(/bypassPermissions|dangerously/);
    const settings = JSON.parse(agent.argv[agent.argv.indexOf("--settings") + 1]);
    expect(settings.enabledPlugins).toEqual({ "codetgh@codetgh": true });
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Read(.env*)", "Bash(git push --force*)", "Edit(//**/.git/**)", "Edit(//**/.claude/**)"]),
    );
    expect(agent.argv.slice(agent.argv.indexOf("--model"))).toEqual(["--model", "sonnet", "--effort", "low"]);
    expect(agent).toMatchObject({ runner: "1", accept: null });
    expect(agent.stdin).toContain('trust="untrusted-peer"');
    expect(agent.stdin).toContain("Subject: plain");

    const [pr] = lines("gh.jsonl");
    expect(pr.argv).toEqual([
      "pr",
      "create",
      "--base=main",
      `--head=codetgh/${slug(parent)}`,
      "--title=plain",
      `--body=Task ${parent} from CodeTgh`,
    ]);
    expect(await row(parent)).toMatchObject({ status: "review", prNumber: 1, branch: `codetgh/${slug(parent)}`, baseBranch: "main" });
    const logs = join(process.env.CODETGH_CONFIG_DIR ?? "", "runner-logs");
    expect(readdirSync(logs)).toContain(`${slug(parent)}-1.log`);
    if (process.platform !== "win32") {
      expect(statSync(logs).mode & 0o777).toBe(0o700);
      expect(statSync(join(logs, `${slug(parent)}-1.log`)).mode & 0o777).toBe(0o600);
    }
  });

  it("stacks a child on its parent's branch while the parent is in review", async () => {
    const child = await create("child", { depends_on: [parent] });
    await runner();
    expect(lines("gh.jsonl").at(-1).argv).toContain(`--base=codetgh/${slug(parent)}`);
    expect(await row(child)).toMatchObject({ status: "review", prNumber: 2, baseBranch: `codetgh/${slug(parent)}` });
    const wt = worktree(child);
    execFileSync("git", ["-C", wt, "merge-base", "--is-ancestor", `origin/codetgh/${slug(parent)}`, "HEAD"]);
  });

  it("sends the hub a fixed reason and the log's name, never the agent's output", async () => {
    const id = await create("FAIL");
    await runner();
    const note = (await row(id))?.notes.at(-1)?.text ?? "";
    expect(note).toBe(`blocked: the agent exited with 1, see runner-logs/${slug(id)}-1.log on the runner`);
    const log = readFileSync(join(process.env.CODETGH_CONFIG_DIR ?? "", "runner-logs", `${slug(id)}-1.log`), "utf8");
    expect(log).toContain("a line only the local log may hold");
  });

  it("pushes nothing when the agent changed the repository's git config", async () => {
    const id = await create("TAMPER");
    await runner();
    expect((await row(id))?.notes.at(-1)?.text).toContain("git config or hooks changed");
    expect(onOrigin(id)).toBe("");
    git(clone, "config", "--unset", "alias.x");
  });

  it("never runs a hook planted in the repository", async () => {
    const marker = join(root, "hook-ran");
    // Hooks the runner's own git would trigger: the worktree checkout and the push.
    const hooks = ["post-checkout", "pre-push"];
    for (const hook of hooks) {
      writeFileSync(join(clone, ".git/hooks", hook), `#!/bin/sh\ntouch "${marker.replaceAll("\\", "/")}"\n`);
      chmodSync(join(clone, ".git/hooks", hook), 0o755);
    }
    const id = await create("hooked");
    await runner();
    for (const hook of hooks) rmSync(join(clone, ".git/hooks", hook));
    expect((await row(id))?.status).toBe("review");
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a routing value that could pass for a flag", () => {
    expect(RoutingRules.safeParse({ rules: [{ match: { role: "author" }, model: "-x" }] }).success).toBe(false);
    expect(RoutingRules.safeParse({ rules: [{ match: { role: "author" }, effort: "--dangerously" }] }).success).toBe(false);
  });

  it("blocks a task whose agent made no commit, and opens no PR", async () => {
    const before = lines("gh.jsonl").length;
    const id = await create("NOCOMMIT");
    await runner();
    expect(lines("gh.jsonl")).toHaveLength(before);
    const r = await row(id);
    expect(r?.status).toBe("blocked");
    expect(r?.notes.at(-1)?.text).toContain("no commit");
  });

  it("runs at most max_agents agents", async () => {
    const a = await create("first");
    const b = await create("second");
    await runner({ max_agents: 1 });
    expect([(await row(a))?.status, (await row(b))?.status]).toEqual(["review", "todo"]);
  });

  it("reports a project switched on but missing from the local list, and never guesses a folder", async () => {
    const id = await create("unlisted");
    const out = await runner({ projects: {} });
    expect(out).toContain("not in this machine's runner list");
    expect((await row(id))?.status).toBe("todo");
    const html = await (await fetch(`${hub.url}/console/projects`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).toContain("not in this machine&#39;s runner list");
  });

  it("refuses a relative folder, and a folder that is not a git repository with an origin", async () => {
    await expect(runner({ projects: { [projectId]: "relative/clone" } })).rejects.toThrow(/absolute/);
    await expect(runner({ projects: { [projectId]: mkdtempSync(join(tmpdir(), "codetgh-not-git-")) } })).rejects.toThrow(/origin/);
  });

  it("kills the agent when the lease is lost, and leaves the task alone", async () => {
    runnerTiming.renewMs = 100;
    const id = await create("SLEEP lost");
    const done = runner();
    const pid = await waitForPid();
    await hub.db.update(task).set({ leaseOwner: "another-runner" }).where(eq(task.id, id));
    const out = await done;
    expect(alive(pid)).toBe(false);
    expect(out).toContain("lease lost");
    expect((await row(id))?.status).toBe("in_progress");
    expect(existsSync(worktree(id))).toBe(true);
    runnerTiming.renewMs = 120_000;
  });

  it("kills an agent that runs past job_timeout_min and blocks the task", async () => {
    const id = await create("SLEEP timeout");
    const done = runner({ job_timeout_min: 0.02 });
    const pid = await waitForPid();
    await done;
    expect(alive(pid)).toBe(false);
    const r = await row(id);
    expect(r?.status).toBe("blocked");
    expect(r?.notes.at(-1)?.text).toContain("0.02 min");
  });

  it("passes bypassPermissions only when runner.json asks for it", async () => {
    await create("bypass");
    await runner({ permission_mode: "bypassPermissions", auto_merge: true });
    expect(lines("claude.jsonl").at(-1).argv).toEqual(expect.arrayContaining(["--permission-mode", "bypassPermissions"]));
    expect(lines("gh.jsonl").at(-1).argv).toEqual(["pr", "merge", expect.stringMatching(/^\d+$/), "--merge", "--auto"]);
  });

  it("turns the delegate Bash check on in a runner job", async () => {
    const bash = (command: string) =>
      runHook(
        "pre-bash",
        { session_id: "lea-runner-bash", tool_name: "Bash", tool_input: { command } },
        { ...hookEnv(hub.url, team.lea.token), CODETGH_RUNNER: "1" },
      );
    const secret = await bash("cat .env");
    expect(secret.code).toBe(2);
    expect(secret.err).toContain("blocked:");
    expect(await bash("git push -u origin codetgh/x")).toMatchObject({ code: 0, raw: "", err: "" });
  });
});
