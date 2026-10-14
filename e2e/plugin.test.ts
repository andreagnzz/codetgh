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
    if (name !== "codetgh") expect(fm["disable-model-invocation"]).toBe("true");
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
