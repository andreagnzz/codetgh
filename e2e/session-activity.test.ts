import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { callOnce, type Hub, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook, systemMessage } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
let sam: Record<string, string>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
  // The poll runs at most every 10 s: tests ask for every call.
  sam = { ...hookEnv(hub.url, team.sam.token), CODETGH_POLL_MS: "0" };
});
afterAll(() => hub.stop());

const start = async (env: Record<string, string>, session: string, source = "startup") =>
  systemMessage(await runHook("session-start", { session_id: session, source, cwd: repo }, env));
const row = async (session: string) => (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0];
// What a teammate (Léa) reads of Sam's session in team_overview.
const sessionsOfSam = async () => {
  const ov = JSON.parse((await callOnce(hub.url, team.lea.token, "team_overview", { handle: "@sam" })).text);
  return ov.people[0]?.sessions as Array<{ agent: string; activity: Record<string, unknown> }>;
};
const activityOf = async (session: string) => (await sessionsOfSam()).find((s) => s.agent === (id[session] ?? ""))?.activity;
const id: Record<string, string> = {};

it("follows a turn: the prompt hook says in_turn, a poll names the tool, Stop says idle", async () => {
  await start(hookEnv(hub.url, team.lea.token), "lea-act");
  await start(sam, "sam-act");
  id["sam-act"] = (await row("sam-act"))?.id ?? "";
  expect(await activityOf("sam-act")).toEqual({ state: "unknown", since_s: null });

  await runHook("user-prompt-submit", { session_id: "sam-act", cwd: repo, prompt: "go" }, sam);
  expect(await row("sam-act")).toMatchObject({ activity: "in_turn", lastTool: null });
  expect(await activityOf("sam-act")).toMatchObject({ state: "in_turn", since_s: expect.any(Number) });

  // The tool's name only: its input never leaves the machine.
  await runHook("inbox", { session_id: "sam-act", cwd: repo, tool_name: "Bash", tool_input: { command: "echo CMD-MARKER-8431" } }, sam);
  expect(await row("sam-act")).toMatchObject({ activity: "in_turn", lastTool: "Bash" });
  expect(await activityOf("sam-act")).toMatchObject({ state: "in_turn", last_tool: "Bash", last_tool_age_s: expect.any(Number) });
  expect(JSON.stringify(await hub.db.select().from(agent))).not.toContain("CMD-MARKER-8431");

  await runHook("stop", { session_id: "sam-act", cwd: repo }, sam);
  expect(await row("sam-act")).toMatchObject({ activity: "idle" });
  const idle = await activityOf("sam-act");
  expect(idle).toMatchObject({ state: "idle" });
  expect(idle).not.toHaveProperty("last_tool");
});

it("leaves another person's session alone, whatever session id a hook sends", async () => {
  await runHook("user-prompt-submit", { session_id: "lea-act", cwd: repo, prompt: "go" }, sam);
  await runHook("inbox", { session_id: "lea-act", cwd: repo, tool_name: "Bash" }, sam);
  await runHook("stop", { session_id: "lea-act", cwd: repo }, sam);
  expect(await row("lea-act")).toMatchObject({ activity: null, lastTool: null });
});
