import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";

const root = fileURLToPath(new URL("../packages/plugin/", import.meta.url));
const frontmatter = (file: string) => {
  const head = readFileSync(file, "utf8").split("---")[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((l) => (/^[\w-]+:/.test(l) ? [[l.split(":")[0], l.slice(l.indexOf(":") + 1).trim()]] : [])),
  );
};

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("keeps skill descriptions short and user commands out of the model's reach", () => {
  const skills = readdirSync(`${root}skills`);
  expect(skills).toEqual(expect.arrayContaining(["handoff", "claims", "split"]));
  for (const name of skills) {
    const fm = frontmatter(`${root}skills/${name}/SKILL.md`);
    expect(fm.name).toBe(name);
    expect(String(fm.description).length).toBeLessThanOrEqual(200);
    // The orchestrator's model loads its role on its own; the hub refuses a verdict from anyone else.
    if (name !== "codetgh" && name !== "orchestrate") expect(fm["disable-model-invocation"]).toBe("true");
  }
});

// /codetgh:split creates tasks for teammates: only the user's own flags skip the review, and it names real hub tools.
it("documents split's approval flags and calls only tools the hub has", async () => {
  const text = readFileSync(`${root}skills/split/SKILL.md`, "utf8");
  expect(text).toContain("--yes");
  expect(text).toContain("--dispatch");
  expect(text).toMatch(/never turns a mode on/);
  expect(text).toMatch(/create nothing until the user approves/);
  // --run: the runner is an assignee, flagged by an owner or an admin only, and gets only self-contained work.
  expect(text).toContain("--run");
  expect(text).toContain("`runner: true`");
  expect(text).toMatch(/only an owner or an admin may set/);
  expect(text).toMatch(/propose the plan as without `--run`/);
  expect(text).toMatch(/self-contained, well specified, covered by tests and touch few files/);
  expect(text).toMatch(/product judgment, secrets or access .*manual QA, or an OS other than Linux/);
  expect(text).toMatch(/same files go to one owner \(one person, or the runner\)/);
  expect(text).toContain("with `runner` as the assignee");
  expect(text).toMatch(/`Size: S`, `Size: M` or `Size: L` \(tasks have no size field\)/);
  const client = await mcpClient(hub.url, team.sam.token);
  const tools = new Set((await client.listTools()).tools.map((t) => t.name));
  await client.close();
  for (const name of ["whoami", "team_overview", "task_list", "memory_search", "task_create", "send_message", "ask_peer"])
    expect(tools.has(name), name).toBe(true);
});

// The liaison reads untrusted peer text: it gets the hub's read tools and nothing else, not the user's other connectors.
it("gives the liaison subagent exactly the hub's read tools", async () => {
  const fm = frontmatter(`${root}agents/liaison.md`);
  const allowed = String(fm.tools)
    .split(",")
    .map((s) => s.trim());
  const client = await mcpClient(hub.url, team.sam.token);
  const tools = (await client.listTools()).tools;
  await client.close();
  const reads = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => `mcp__plugin_codetgh_hub__${t.name}`);
  expect(allowed.sort()).toEqual(reads.sort());
});

it("offers only the hooks and rewake push modes to members", () => {
  const manifest = JSON.parse(readFileSync(`${root}.claude-plugin/plugin.json`, "utf8"));
  expect(manifest.userConfig.push_mode.options).toEqual(["hooks", "rewake"]);
  expect(manifest.userConfig.push_mode.description).not.toContain("channel");
});

// Needs the claude CLI (not on CI): Claude Code's own validator and test kit read the mod as a session would.
const claude = spawnSync("claude", ["--version"]).status === 0;
it.skipIf(!claude)("ships a presence mod that Claude Code validates and whose own tests pass", () => {
  const validate = spawnSync("claude", ["plugin", "validate", root], { encoding: "utf8" });
  expect(validate.status, validate.stdout + validate.stderr).toBe(0);
  expect(validate.stdout).toContain("./presence.ts hooks: session.start, turn.start, turn.complete");
  expect(validate.stdout).toContain("./presence.ts calls: $.clock.after, $.clock.every, $.clock.now, $.http.fetch");
  expect(validate.stdout).toContain("$.prompt.submit (via submit), $.session.id (via refresh, tell), $.session.usage (via refresh)");
  const tests = spawnSync("claude", ["plugin", "test", root], { encoding: "utf8" });
  expect(tests.status, tests.stdout + tests.stderr).toBe(0);
});
