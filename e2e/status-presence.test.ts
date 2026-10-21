import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

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

// The presence mod wakes an idle session when this count rises: it must count only what that session can read.
it("counts the unread messages the polling session can read, not those addressed to another of the person's agents", async () => {
  const old = (await startSession(hub.url, team.sam.token, "sam-old", { repo: ACME_REPO })).agent_id ?? "";
  await startSession(hub.url, team.sam.token, "sam-new", { repo: ACME_REPO });
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(malik, "send_message", { to: `agent:${old}`, kind: "note", body: "for the old session only" });
  const unread = async (query: string) => {
    const res = await fetch(`${hub.url}/v1/status${query}`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
    return Object.values(((await res.json()) as { unread: Record<string, number> }).unread).reduce((n, k) => n + k, 0);
  };
  expect(await unread("?session_id=sam-new")).toBe(0);
  expect(await unread("?session_id=sam-old")).toBe(1);
  // Without a session (the CLI), the person's whole inbox, as before.
  expect(await unread("")).toBe(1);
});

// An ended, unknown or stale session id must not fall back to the person's whole inbox, nor register the CLI agent.
it("counts no unread for a session id that is not live, keeps the rest of the overview, and creates no agent", async () => {
  const sess = (await startSession(hub.url, team.lea.token, "lea-gone", { repo: ACME_REPO })).agent_id ?? "";
  await hub.db.update(agent).set({ endedAt: new Date() }).where(eq(agent.id, sess));
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(malik, "send_message", { to: "@lea", kind: "note", body: "for any of Léa's sessions" });
  await malik.close();
  const before = (await hub.db.select().from(agent).where(eq(agent.userId, team.lea.userId))).length;
  for (const id of ["lea-gone", "lea-never"]) {
    const res = await status(team.lea.token, id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unread: Record<string, number>; you: { handle: string }; agents: unknown[] };
    expect(body.unread).toEqual({});
    expect(body.you.handle).toBe("lea");
    expect(Array.isArray(body.agents)).toBe(true);
  }
  expect((await hub.db.select().from(agent).where(eq(agent.userId, team.lea.userId))).length).toBe(before);
});
