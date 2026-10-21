import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const status = (token: string, sessionId: string) =>
  fetch(`${hub.url}/v1/status?session_id=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
const seen = async (id: string) => (await hub.db.select().from(agent).where(eq(agent.id, id)))[0]?.lastSeenAt.getTime() ?? 0;

// The presence mod polls /v1/status every 30 s with its session id: an open session idle at the prompt stays online.
it("refreshes the presence of the caller's own session only, and creates no agent", async () => {
  const sam = (await startSession(hub.url, team.sam.token, "sam-idle")).agent_id ?? "";
  const malik = (await startSession(hub.url, team.malik.token, "malik-idle")).agent_id ?? "";
  const old = new Date(Date.now() - 5 * 60_000);
  await hub.db.update(agent).set({ lastSeenAt: old });

  expect((await status(team.sam.token, "malik-idle")).status).toBe(200);
  expect(await seen(malik)).toBe(old.getTime());
  expect((await status(team.sam.token, "sam-idle")).status).toBe(200);
  expect(await seen(sam)).toBeGreaterThan(Date.now() - 10_000);

  await status(team.sam.token, "sam-unknown");
  const unknown = await hub.db
    .select()
    .from(agent)
    .where(and(eq(agent.userId, team.sam.userId), eq(agent.sessionId, "sam-unknown")));
  expect(unknown).toEqual([]);
});
