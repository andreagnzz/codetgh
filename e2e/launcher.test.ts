import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { type Keyring, program } from "../packages/cli/src/main.js";
import { consolePost, fakeCommand } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let projectId = "";
const PATH = process.env.PATH;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-launch", { repo: ACME_REPO });
  projectId = (await hub.db.select().from(project).where(eq(project.teamId, team.teamId)))[0]?.id ?? "";
});
afterAll(async () => {
  process.env.PATH = PATH;
  await hub.stop();
});

const targets = (token: string) => fetch(`${hub.url}/v1/launcher/targets`, { headers: { Authorization: `Bearer ${token}` } });
const projectsPage = async () => (await fetch(`${hub.url}/console/projects`, { headers: { cookie: team.lea.cookie } })).text();

// A fake claude: writes its arguments and directory, then stays alive like the real server.
function fakeClaude() {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  fakeCommand(
    dir,
    "claude",
    `import { writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = ${JSON.stringify(dir)};
writeFileSync(join(dir, "args"), process.argv.slice(2).join(" "));
writeFileSync(join(dir, "cwd"), process.cwd());
writeFileSync(join(dir, "pid"), String(process.pid));
setTimeout(() => {}, 300_000);
`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
  return dir;
}
async function launcher(config: string) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = team.lea.token;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "launcher", "--config", config, "--once"]);
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_TOKEN;
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

describe("Remote Control launcher", () => {
  it("lets only the owner switch a project's server on, and only the owner's token read the targets", async () => {
    expect((await consolePost(hub.url, team.sam.cookie, `/console/projects/${projectId}/launch`, { on: "1" })).status).toBe(403);
    expect((await targets(team.sam.token)).status).toBe(403);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/projects/${projectId}/launch`, { on: "1" })).status).toBe(204);
    const body = await (await targets(team.lea.token)).json();
    expect(body.targets).toEqual([expect.objectContaining({ project_id: projectId, desired: true })]);
    expect(JSON.stringify(body)).not.toMatch(/path|command|cwd/);
  });

  it("starts the fixed claude command only in a folder from its own local list, and reports it", async () => {
    const fake = fakeClaude();
    const repoDir = mkdtempSync(join(tmpdir(), "codetgh-launch-repo-"));
    const config = join(mkdtempSync(join(tmpdir(), "codetgh-launch-cfg-")), "launcher.json");
    writeFileSync(config, JSON.stringify({ projects: { [projectId]: repoDir } }));
    await launcher(config);
    for (let i = 0; i < 50 && !existsSync(join(fake, "pid")); i++) await sleep(50);
    expect(readFileSync(join(fake, "args"), "utf8")).toMatch(/^remote-control --name CodeTgh · /);
    expect(readFileSync(join(fake, "cwd"), "utf8").trim()).toBe(repoDir);
    expect(await projectsPage()).toContain("Remote Control running");

    // Switched off in the console: the next pass stops the server.
    const pid = Number(readFileSync(join(fake, "pid"), "utf8"));
    expect(alive(pid)).toBe(true);
    await consolePost(hub.url, team.lea.cookie, `/console/projects/${projectId}/launch`, { on: "0" });
    await launcher(config);
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(50);
    expect(alive(pid)).toBe(false);
    expect(await projectsPage()).toContain("Remote Control stopped");
  });

  it("refuses a project that is not in its local list, and says so in the console", async () => {
    await consolePost(hub.url, team.lea.cookie, `/console/projects/${projectId}/launch`, { on: "1" });
    const config = join(mkdtempSync(join(tmpdir(), "codetgh-launch-cfg-")), "launcher.json");
    writeFileSync(config, JSON.stringify({ projects: {} }));
    expect(await launcher(config)).toContain("not in this machine's launcher list");
    expect(await projectsPage()).toContain("not in this machine&#39;s launcher list");
  });
});
