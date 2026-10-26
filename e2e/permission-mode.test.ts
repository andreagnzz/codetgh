import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, team as teamTable } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost, fakeGithubToken, gitRepo, hookEnv, runHook, systemMessage } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
let sam: Record<string, string>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
  sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "lea-pm", source: "startup", cwd: repo }, hookEnv(hub.url, team.lea.token));
});
afterAll(() => hub.stop());

const mode = async (session: string) =>
  (await hub.db.select({ m: agent.permissionMode }).from(agent).where(eq(agent.sessionId, session)))[0]?.m;
type Out = {
  systemMessage?: string;
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
} | null;

it("shows a bypass session to its person and to the team, and follows a mode change", async () => {
  const start = await runHook(
    "session-start",
    { session_id: "sam-pm", source: "startup", cwd: repo, permission_mode: "bypassPermissions" },
    sam,
  );
  const line = systemMessage(start);
  expect(line).toMatch(/· bypass ·/);
  expect(line).toContain("⚠ bypass: permission prompts are off");
  expect(await mode("sam-pm")).toBe("bypassPermissions");

  const who = await (
    await fetch(`${hub.url}/v1/whoami?session_id=sam-pm`, { headers: { authorization: `Bearer ${team.sam.token}` } })
  ).json();
  expect(who.agent.permission_mode).toBe("bypassPermissions");
  const html = await (await fetch(`${hub.url}/console/agents`, { headers: { cookie: team.lea.cookie } })).text();
  expect(html).toContain("Permissions");
  expect(html).toContain("bypass");

  // shift+tab back to Manual: the next prompt reports it.
  await runHook("user-prompt-submit", { session_id: "sam-pm", cwd: repo, prompt: "go on", permission_mode: "default" }, sam);
  expect(await mode("sam-pm")).toBe("default");
});

it("still blocks secrets in bypass, and warns on a claim conflict", async () => {
  const key = fakeGithubToken();
  const secret = (
    await runHook(
      "pre-tool-use",
      {
        session_id: "sam-pm",
        permission_mode: "bypassPermissions",
        tool_name: "mcp__plugin_codetgh_hub__send_message",
        tool_input: { to: "@lea", kind: "note", body: `key ${key}` },
      },
      sam,
    )
  ).out as Out;
  expect(secret?.hookSpecificOutput?.permissionDecision).toBe("deny");

  // The hub refuses the secret whatever the session's mode.
  const samMcp = await mcpClient(hub.url, team.sam.token);
  const r = await call(samMcp, "send_message", { to: "@lea", kind: "note", body: `key ${key}` });
  expect(JSON.parse(r.text).code).toBe("E_SECRET_BLOCKED");
  await samMcp.close();

  // A team that stored the old block level now asks, and in bypass an ask turns into a warning.
  const lea = await mcpClient(hub.url, team.lea.token);
  expect((await call(lea, "claim", { scope: ["src/**"], mode: "exclusive" })).isError).toBe(false);
  await lea.close();
  await hub.db
    .update(teamTable)
    .set({ settings: { claims_enforcement: "block" } })
    .where(eq(teamTable.id, team.teamId));
  const edit = (
    await runHook(
      "pre-edit",
      {
        session_id: "sam-pm",
        cwd: repo,
        permission_mode: "bypassPermissions",
        tool_name: "Edit",
        tool_input: { file_path: join(repo, "src/a.ts") },
      },
      sam,
    )
  ).out as Out;
  expect(edit?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(edit?.hookSpecificOutput?.additionalContext).toMatch(/^CodeTgh: .*Léa/s);
});
