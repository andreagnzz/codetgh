import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost, fakeCommand, gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let env: Record<string, string>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
  const bin = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  fakeCommand(bin, "claude", 'if (process.argv[2] === "--version") console.log("2.1.299 (Claude Code)");\n');
  env = {
    ...hookEnv(hub.url, team.sam.token),
    CLAUDE_PLUGIN_OPTION_PUSH_MODE: "rewake",
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  };
});
afterAll(() => hub.stop());

const start = async (session: string) => {
  const r = await runHook("session-start", { session_id: session, source: "startup", cwd: repo }, env);
  return String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");
};

it("tells the person at startup that CodeTgh is on, with the push mode and Claude Code version", async () => {
  const line = await start("sam-status");
  expect(line).toMatch(/^CodeTgh ✓ acme\/webapp · @sam · push rewake · Claude Code 2\.1\.299 · \d+ online · \d+ unread/);
  // The team has not allowed rewake: the person learns it here instead of never being woken.
  expect(line).toContain("rewake is off for this team");

  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-status"));
  expect(row?.pushMode).toBe("rewake");
  expect(row?.clientVersion).toBe("2.1.299");
});

it("drops the warning once an admin allows rewake", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    push_hooks: "on",
    push_rewake: "on",
  });
  expect(await start("sam-status-2")).not.toContain("rewake is off");
});

it("shows each session's push mode and Claude Code version to the team", async () => {
  const html = await (await fetch(`${hub.url}/console/agents`, { headers: { cookie: team.lea.cookie } })).text();
  expect(html).toContain("Push");
  expect(html).toContain("2.1.299");
  const lea = await mcpClient(hub.url, team.lea.token);
  const overview = JSON.parse((await call(lea, "team_overview", { scope: "team" })).text);
  expect(overview.agents).toContainEqual(expect.objectContaining({ handle: "sam", push_mode: "rewake", client_version: "2.1.299" }));
});
