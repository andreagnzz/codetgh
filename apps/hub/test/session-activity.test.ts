import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const ids: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  ids.sam = (await startSession(hub.url, team.sam.token, "sam-a", { repo: ACME_REPO })).agent_id ?? "";
  ids.lea = (await startSession(hub.url, team.lea.token, "lea-a", { repo: ACME_REPO })).agent_id ?? "";
});
afterAll(() => hub.stop());

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (token: string, path: string) => fetch(`${hub.url}${path}`, { headers: auth(token) });
const post = (token: string, path: string, body: unknown) =>
  fetch(`${hub.url}${path}`, {
    method: "POST",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const row = async (session: string) => (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0];
const mark = (session: string, set: Partial<typeof agent.$inferInsert>) =>
  hub.db.update(agent).set(set).where(eq(agent.sessionId, session));
const minAgo = (n: number) => new Date(Date.now() - n * 60_000);

type Activity = { state: string; since_s: number | null; last_tool?: string; last_tool_age_s?: number };
const activityOf = async (token: string, handle: string, session: string): Promise<Activity | undefined> => {
  const client = await mcpClient(hub.url, token);
  const ov = JSON.parse((await call(client, "team_overview", { handle: `@${handle}` })).text) as {
    people: Array<{ sessions: Array<{ agent: string; activity: Activity }> }>;
  };
  await client.close();
  return ov.people[0]?.sessions.find((s) => s.agent === ids[session])?.activity;
};

it("shows no activity as unknown, the old behaviour of a session that reports nothing", async () => {
  expect(await activityOf(team.lea.token, "sam", "sam")).toEqual({ state: "unknown", since_s: null });
});

it("stores the state and the tool name the prompt call reports, and the idle state the Stop call posts", async () => {
  const prompt = await get(team.sam.token, "/v1/inbox/prompt?session_id=sam-a&activity=in_turn&tool=mcp__plugin_codetgh_hub__send_message");
  expect([200, 204]).toContain(prompt.status);
  let r = await row("sam-a");
  expect(r).toMatchObject({ activity: "in_turn", lastTool: "mcp__plugin_codetgh_hub__send_message" });
  expect(r?.activityAt).toBeInstanceOf(Date);
  expect(r?.lastToolAt).toBeInstanceOf(Date);
  expect(await activityOf(team.lea.token, "sam", "sam")).toMatchObject({
    state: "in_turn",
    last_tool: "mcp__plugin_codetgh_hub__send_message",
    since_s: expect.any(Number),
    last_tool_age_s: expect.any(Number),
  });

  const stop = await post(team.sam.token, "/v1/agents/activity", { session_id: "sam-a", activity: "idle" });
  expect(stop.status).toBe(204);
  r = await row("sam-a");
  expect(r?.activity).toBe("idle");
  // Idle says nothing of a tool: the last one belongs to the turn that ended.
  const idle = await activityOf(team.lea.token, "sam", "sam");
  expect(idle).toMatchObject({ state: "idle" });
  expect(idle).not.toHaveProperty("last_tool");
});

it("never touches another person's session, nor an ended one", async () => {
  await get(team.sam.token, "/v1/inbox/prompt?session_id=lea-a&activity=in_turn&tool=Bash");
  expect((await post(team.sam.token, "/v1/agents/activity", { session_id: "lea-a", activity: "in_turn" })).status).toBe(204);
  expect(await row("lea-a")).toMatchObject({ activity: null, lastTool: null });

  await startSession(hub.url, team.sam.token, "sam-gone", { repo: ACME_REPO });
  await post(team.sam.token, "/v1/agents/session/end", { session_id: "sam-gone" });
  await get(team.sam.token, "/v1/inbox/prompt?session_id=sam-gone&activity=in_turn&tool=Bash");
  await post(team.sam.token, "/v1/agents/activity", { session_id: "sam-gone", activity: "in_turn" });
  expect(await row("sam-gone")).toMatchObject({ activity: null, lastTool: null });
});

it("ignores a bad state or a bad tool name, and refuses a bad body", async () => {
  await mark("sam-a", { activity: "idle", lastTool: "Read" });
  const long = "a".repeat(81);
  for (const query of ["activity=busy", "tool=rm%20-rf%20%2F", "tool=%3Cb%3E", `tool=${long}`, "tool=", "activity=in_turn%0Aidle"]) {
    const res = await get(team.sam.token, `/v1/inbox/prompt?session_id=sam-a&${query}`);
    expect([200, 204], query).toContain(res.status);
    const r = await row("sam-a");
    expect(r?.lastTool, query).toBe("Read");
    // Only the valid state of the last query could change it, and none is valid.
    expect(r?.activity, query).toBe("idle");
  }
  const bad = await post(team.sam.token, "/v1/agents/activity", { session_id: "sam-a", activity: "busy" });
  expect(bad.status).toBe(400);
  expect((await row("sam-a"))?.activity).toBe("idle");
  expect((await post(team.sam.token, "/v1/agents/activity", { activity: "idle" })).status).toBe(400);
  expect((await fetch(`${hub.url}/v1/agents/activity`, { method: "POST", body: "{}" })).status).toBe(401);
});

it("takes a tool in use as a turn, without moving the start of a turn already running", async () => {
  await mark("sam-a", { activity: "idle", activityAt: minAgo(30), lastTool: null, lastToolAt: null });
  await get(team.sam.token, "/v1/inbox/prompt?session_id=sam-a&tool=Bash");
  let r = await row("sam-a");
  expect(r?.activity).toBe("in_turn");
  const since = r?.activityAt?.getTime() ?? 0;
  expect(Date.now() - since).toBeLessThan(10_000);

  await mark("sam-a", { activityAt: minAgo(4) });
  await get(team.sam.token, "/v1/inbox/prompt?session_id=sam-a&tool=Edit");
  r = await row("sam-a");
  expect(r).toMatchObject({ activity: "in_turn", lastTool: "Edit" });
  expect(Date.now() - (r?.activityAt?.getTime() ?? 0)).toBeGreaterThan(3 * 60_000);
  const seen = await activityOf(team.lea.token, "sam", "sam");
  expect(seen?.since_s).toBeGreaterThanOrEqual(239);
  expect(seen?.last_tool).toBe("Edit");
});

// A session killed without its Stop hook stays in_turn in the database until the 12 h expiry.
it("shows an in_turn older than 15 minutes as unknown unless the session shows signs of life", async () => {
  const stale = { activity: "in_turn" as const, activityAt: minAgo(20), lastTool: "Bash", lastToolAt: minAgo(19) };
  // Heard 5 min ago (idle), no tool for 19 min: nothing says it is still working.
  await mark("sam-a", { ...stale, lastSeenAt: minAgo(5) });
  const unknown = await activityOf(team.lea.token, "sam", "sam");
  expect(unknown).toMatchObject({ state: "unknown", since_s: expect.any(Number) });
  expect(unknown).not.toHaveProperty("last_tool");
  expect(unknown?.since_s).toBeGreaterThanOrEqual(1199);

  // A tool seen in the last 15 min.
  await mark("sam-a", { lastToolAt: minAgo(1) });
  expect(await activityOf(team.lea.token, "sam", "sam")).toMatchObject({ state: "in_turn", last_tool: "Bash" });

  // A long command: no tool for 19 min, but the presence mod hears from the session every 30 s.
  await mark("sam-a", { lastToolAt: minAgo(19), lastSeenAt: new Date() });
  expect(await activityOf(team.lea.token, "sam", "sam")).toMatchObject({ state: "in_turn" });

  // A tool from a previous turn is not this turn's.
  await mark("sam-a", { activityAt: minAgo(2), lastToolAt: minAgo(10) });
  const fresh = await activityOf(team.lea.token, "sam", "sam");
  expect(fresh).toMatchObject({ state: "in_turn" });
  expect(fresh).not.toHaveProperty("last_tool");

  // Idle is believed whatever its age.
  await mark("sam-a", { activity: "idle", activityAt: minAgo(300), lastSeenAt: minAgo(5) });
  expect(await activityOf(team.lea.token, "sam", "sam")).toMatchObject({ state: "idle" });
});

it("serves the same activity to /v1/status", async () => {
  await mark("sam-a", { activity: "in_turn", activityAt: minAgo(1), lastTool: "Grep", lastToolAt: minAgo(0.5), lastSeenAt: new Date() });
  const res = await get(team.lea.token, "/v1/status?session_id=lea-a");
  const body = (await res.json()) as { people: Array<{ handle: string; sessions: Array<{ activity: Activity }> }> };
  expect(body.people.find((p) => p.handle === "sam")?.sessions[0]?.activity).toMatchObject({ state: "in_turn", last_tool: "Grep" });
});
