import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { membership } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, setRole, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
});
afterAll(() => hub.stop());

const status = (token: string, query: string) => fetch(`${hub.url}/v1/status?${query}`, { headers: { Authorization: `Bearer ${token}` } });

// SPEC « Capacité » : /codetgh:split reads who can take which task from team_overview.
it("reports platform at session start and usage on the status poll, and shows them with delegates and open tasks", async () => {
  await runHook("session-start", { session_id: "sam-cap", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  const reset = Math.round(Date.now() / 1000) + 3600;
  expect((await status(team.sam.token, `session_id=sam-cap&five_hour=42&five_hour_reset=${reset}&seven_day=7`)).status).toBe(200);
  // A poll for a session that is not the caller's stores nothing.
  expect((await status(team.malik.token, "session_id=sam-cap&five_hour=99")).status).toBe(200);

  const lea = await mcpClient(hub.url, team.lea.token);
  const samMcp = await mcpClient(hub.url, team.sam.token);
  for (const title of ["Windows check", "Docs"]) {
    const t = JSON.parse((await call(lea, "task_create", { title, assignee: "@sam" })).text);
    const c = JSON.parse((await call(samMcp, "task_claim", { task_id: t.id, expected_version: t.version })).text);
    if (title === "Docs") continue;
    await call(samMcp, "task_update", { task_id: t.id, expected_version: c.version, patch: { status: "in_progress" } });
  }
  await samMcp.close();
  const ov = JSON.parse((await call(lea, "team_overview", { scope: "team" })).text);
  expect(ov.people).toContainEqual(
    expect.objectContaining({
      handle: "sam",
      usage: { five_hour: { pct: 42, resets_at: new Date(reset * 1000).toISOString() }, seven_day: { pct: 7, resets_at: null } },
      open_tasks: { claimed: 1, in_progress: 1 },
      sessions: [expect.objectContaining({ platform: process.platform, delegate_for: null })],
    }),
  );
  await lea.close();
  const [malik] = await hub.db.select().from(membership).where(eq(membership.userId, team.malik.userId));
  expect(malik?.usageFiveHour).toBeNull();
});

it("names the teammates a delegate session works for", async () => {
  const env = { ...hookEnv(hub.url, team.malik.token), CODETGH_ACCEPT_REQUESTS_FROM: "@lea" };
  await runHook("session-start", { session_id: "malik-del", source: "startup", cwd: repo }, env);
  const lea = await mcpClient(hub.url, team.lea.token);
  const ov = JSON.parse((await call(lea, "team_overview", { scope: "team" })).text);
  expect(ov.people).toContainEqual(
    expect.objectContaining({ handle: "malik", sessions: [expect.objectContaining({ delegate_for: ["@lea"] })] }),
  );
  await lea.close();
});

it("keeps usage from guests", async () => {
  await setRole(hub, team.malik.userId, "guest");
  const malik = await mcpClient(hub.url, team.malik.token);
  expect((await call(malik, "team_overview", { scope: "team" })).isError).toBe(true);
  await malik.close();
  const res = await status(team.malik.token, "");
  expect(res.status).not.toBe(200);
  expect(await res.text()).not.toContain("usage");
});
