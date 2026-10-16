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
  expect(skills).toEqual(expect.arrayContaining(["handoff", "claims"]));
  for (const name of skills) {
    const fm = frontmatter(`${root}skills/${name}/SKILL.md`);
    expect(fm.name).toBe(name);
    expect(String(fm.description).length).toBeLessThanOrEqual(200);
    // The orchestrator's model loads its role on its own; the hub refuses a verdict from anyone else.
    if (name !== "codetgh" && name !== "orchestrate") expect(fm["disable-model-invocation"]).toBe("true");
  }
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
  expect(validate.stdout).toContain("./presence.ts hooks: session.start");
  expect(validate.stdout).toContain("./presence.ts calls: $.clock.after, $.clock.every, $.http.fetch");
  const tests = spawnSync("claude", ["plugin", "test", root], { encoding: "utf8" });
  expect(tests.status, tests.stdout + tests.stderr).toBe(0);
});
