import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { expireStaleSessions } from "../apps/hub/src/domain/agents.js";
import { callOnce, type Hub, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook, systemMessage } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
});
afterAll(() => hub.stop());

const start = async (token: string, session: string) =>
  systemMessage(await runHook("session-start", { session_id: session, source: "startup", cwd: repo }, hookEnv(hub.url, token)));

// Field report (Orma run): every restart made a new agent, and each one was listed as if it were another teammate.
it("shows a teammate once, with only the sessions still open after the 12 h expiry, in team_overview and /v1/status", async () => {
  for (const s of ["lea-mon", "lea-tue", "lea-now"]) await start(team.lea.token, s);
  // Three sessions, one person.
  expect(await start(team.sam.token, "sam-now")).toMatch(/ · 1 online · /);

  await hub.db
    .update(agent)
    .set({ lastSeenAt: new Date(Date.now() - 13 * 3_600_000) })
    .where(inArray(agent.sessionId, ["lea-mon", "lea-tue"]));
  await expireStaleSessions(hub.db);
  const rows = await hub.db
    .select()
    .from(agent)
    .where(inArray(agent.sessionId, ["lea-mon", "lea-tue", "lea-now"]));
  expect(rows.filter((r) => r.endedAt).map((r) => r.sessionId)).toEqual(expect.arrayContaining(["lea-mon", "lea-tue"]));
  const now = rows.find((r) => r.sessionId === "lea-now");
  expect(now?.endedAt).toBeNull();

  const ov = JSON.parse((await callOnce(hub.url, team.sam.token, "team_overview")).text);
  expect(ov.people).toEqual([
    expect.objectContaining({ handle: "lea", sessions: [expect.objectContaining({ agent: now?.id, presence: "online" })] }),
  ]);
  // The presence mod and codetgh status read the same people.
  const res = await fetch(`${hub.url}/v1/status?session_id=sam-now`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
  expect(((await res.json()) as { people: unknown }).people).toEqual(ov.people);
});
