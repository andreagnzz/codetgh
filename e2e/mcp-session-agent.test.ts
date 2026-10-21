import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { fakeGithubToken, gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const TOOL = "mcp__plugin_codetgh_hub__task_create";
type Out = { permissionDecision?: string; updatedInput?: Record<string, unknown> };
const row = async (session: string) => (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0];

// Seen in production: MCP calls carry no session, so the hub filed one session's tasks under another of the same token.
it("adds the session's agent to a hub tool call that names none, without deciding the permission", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const cwd = gitRepo("git@github.com:acme/webapp.git");
  await runHook("session-start", { session_id: "sam-a", source: "startup", cwd }, env);

  const r = await runHook("pre-tool-use", { session_id: "sam-a", cwd, tool_name: TOOL, tool_input: { title: "t" } }, env);
  const out = r.out?.hookSpecificOutput as Out;
  expect(out.updatedInput).toEqual({ title: "t", agent: (await row("sam-a"))?.id });
  // No decision: the person's permission prompts stay as their rules make them.
  expect(out.permissionDecision).toBeUndefined();

  // The claude.ai connector's CodeTgh tools reach the hub over OAuth, with no session either.
  const connector = await runHook(
    "pre-tool-use",
    { session_id: "sam-a", tool_name: "mcp__claude_ai_CodeTgh__inbox_read", tool_input: {} },
    env,
  );
  expect((connector.out?.hookSpecificOutput as Out | undefined)?.updatedInput).toEqual({ agent: (await row("sam-a"))?.id });

  // An agent the model already names is left alone.
  const named = await runHook("pre-tool-use", { session_id: "sam-a", tool_name: TOOL, tool_input: { title: "t", agent: "agt_x" } }, env);
  expect(named.out).toBeNull();

  // A secret still denies, and the input is not rewritten.
  const secret = await runHook("pre-tool-use", { session_id: "sam-a", tool_name: TOOL, tool_input: { title: fakeGithubToken() } }, env);
  const denied = secret.out?.hookSpecificOutput as Out;
  expect(denied.permissionDecision).toBe("deny");
  expect(denied.updatedInput).toBeUndefined();
});

it("runs on both the plugin's and the claude.ai connector's CodeTgh tools", () => {
  const hooks = JSON.parse(readFileSync(new URL("../packages/plugin/hooks/hooks.json", import.meta.url), "utf8"));
  const matcher = new RegExp(`^(?:${hooks.hooks.PreToolUse[0].matcher})$`);
  expect(hooks.hooks.PreToolUse[0].hooks[0].args).toContain("pre-tool-use");
  expect(matcher.test("mcp__plugin_codetgh_hub__task_create")).toBe(true);
  expect(matcher.test("mcp__claude_ai_CodeTgh__inbox_read")).toBe(true);
  expect(matcher.test("mcp__claude_ai_Gmail__send_message")).toBe(false);
});

it("does nothing outside a registered session", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const r = await runHook("pre-tool-use", { session_id: "never-started", tool_name: TOOL, tool_input: { title: "t" } }, env);
  expect(r.out).toBeNull();
});

it("picks up the agent when a session started outside a repository joins one", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const home = mkdtempSync(join(tmpdir(), "codetgh-home-"));
  await runHook("session-start", { session_id: "sam-b", source: "startup", cwd: home }, env);
  const repo = gitRepo("git@github.com:acme/billing.git");
  await runHook("cwd-changed", { session_id: "sam-b", cwd: repo, new_cwd: repo }, env);
  const r = await runHook("pre-tool-use", { session_id: "sam-b", tool_name: TOOL, tool_input: { title: "t" } }, env);
  expect((r.out?.hookSpecificOutput as Out | undefined)?.updatedInput?.agent).toBe((await row("sam-b"))?.id);
});
