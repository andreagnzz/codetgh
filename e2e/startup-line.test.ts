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
  sam = hookEnv(hub.url, team.sam.token);
});
afterAll(() => hub.stop());

const start = async (session: string, source: string) =>
  systemMessage(await runHook("session-start", { session_id: session, source, cwd: repo }, sam));

it("puts the agent's short id in the startup line, and a one-line form after /clear and compaction", async () => {
  const startup = await start("sam-line", "startup");
  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-line"));
  const id = row?.id ?? "";
  const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
  expect(id).toMatch(/^agt_[0-9A-Z]{26}$/);
  expect(startup).toContain(` · @sam · ${short} · push hooks · `);

  // The teammate reads the same agent, in full, in team_overview.
  const ov = JSON.parse((await callOnce(hub.url, team.lea.token, "team_overview", { handle: "@sam" })).text);
  expect(ov.people[0].sessions.map((s: { agent: string }) => s.agent)).toContain(id);

  for (const source of ["clear", "compact"])
    expect(await start("sam-line", source), source).toBe(`CodeTgh ✓ acme/webapp · @sam · ${short}`);
  // A resume is a launch: the full line again.
  expect(await start("sam-line", "resume")).toContain(` · @sam · ${short} · push hooks · `);
});
