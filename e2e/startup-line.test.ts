import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook } from "./helpers.js";

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

const start = async (session: string, source: string) => {
  const r = await runHook("session-start", { session_id: session, source, cwd: repo }, sam);
  return String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");
};

it("puts the agent's short id in the startup line, and a one-line form after /clear and compaction", async () => {
  const startup = await start("sam-line", "startup");
  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-line"));
  const id = row?.id ?? "";
  const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
  expect(id).toMatch(/^agt_[0-9A-Z]{26}$/);
  expect(startup).toContain(` · @sam · ${short} · push hooks · `);

  // The teammate reads the same agent, in full, in team_overview.
  const lea = await mcpClient(hub.url, team.lea.token);
  const ov = JSON.parse((await call(lea, "team_overview", { handle: "@sam" })).text);
  await lea.close();
  expect(ov.people[0].sessions.map((s: { agent: string }) => s.agent)).toContain(id);

  for (const source of ["clear", "compact"])
    expect(await start("sam-line", source), source).toBe(`CodeTgh ✓ acme/webapp · @sam · ${short}`);
  // A resume is a launch: the full line again.
  expect(await start("sam-line", "resume")).toContain(` · @sam · ${short} · push hooks · `);
});
