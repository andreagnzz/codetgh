import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, membership } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { createTeam } from "../apps/hub/src/domain/teams.js";
import { newId } from "../apps/hub/src/ids.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

// What E_UNREACHABLE and reach may tell: what team_overview shows the same member, nothing from another team, nothing to a guest.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const ids: Record<string, string> = {};
let now = Date.now();
const HOUR = 3600_000;
const live = (userId: string, sessionId: string, over: Partial<typeof agent.$inferInsert> = {}) => {
  const id = newId("agt");
  return hub.db
    .insert(agent)
    .values({ id, teamId: team.teamId, userId, sessionId, kind: "claude-code", label: sessionId, ...over })
    .then(() => id);
};
beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (now += HOUR)) });
  team = await hub.seed();
  ids["sam-p1"] = (await startSession(hub.url, team.sam.token, "sam-p1", { repo: P1 })).agent_id ?? "";
  ids["lea-p1"] = (await startSession(hub.url, team.lea.token, "lea-p1", { repo: P1 })).agent_id ?? "";
  // Malik: a live session in another team, a removed one here, one that ended long ago, one that ended an hour ago.
  const other = await createTeam(hub.db, "Other");
  ids["other-team"] = await live(team.malik.userId, "malik-other", { teamId: other });
  ids.removed = await live(team.malik.userId, "malik-removed", { removedAt: new Date() });
  const old = new Date(Date.now() - 48 * HOUR);
  ids["ended-long-ago"] = await live(team.malik.userId, "malik-old", { endedAt: old, lastSeenAt: old });
  const hourAgo = new Date(Date.now() - HOUR);
  ids["ended-recently"] = await live(team.malik.userId, "malik-recent", { endedAt: hourAgo, lastSeenAt: hourAgo });
  ids.bridge = await live(team.malik.userId, "malik-bridge", { kind: "bridge" });
});
afterAll(() => hub.stop());

const send = async (args: Record<string, unknown>, token = team.sam.token) => {
  const c = await mcpClient(hub.url, token);
  const r = await call(c, "send_message", { kind: "note", body: "hello", ...args });
  await c.close();
  return { isError: r.isError, out: r.json() };
};
const samSends = (args: Record<string, unknown>) => send({ agent: ids["sam-p1"], ...args });

describe("what the error shows", () => {
  it("lists only what team_overview lists: no other team, no removed agent, no bridge, no ended session as such", async () => {
    const r = await samSends({ to: "@malik", body: "BODYMARK-8841" });
    expect(r.out.code).toBe("E_UNREACHABLE");
    for (const hidden of ["other-team", "removed", "ended-long-ago", "bridge"]) expect(r.out.message).not.toContain(ids[hidden]);
    expect(r.out.message).toContain("1 offline (last seen 1 h ago)");
    expect(r.out.message).not.toMatch(/ended/);
    // The request text is never echoed back.
    expect(JSON.stringify(r.out)).not.toContain("BODYMARK-8841");
  });

  it("answers alike for an agent id that does not exist, is in another team, was removed or ended long ago", async () => {
    const unknown = `agt_${"0".repeat(26)}`;
    const answers = [];
    for (const id of [unknown, ids["other-team"], ids.removed, ids["ended-long-ago"]] as string[])
      for (const allow_offline of [false, true]) {
        const r = await samSends({ to: `agent:${id}`, allow_offline });
        expect(r.isError).toBe(true);
        answers.push(`${r.out.code} ${String(r.out.message).replace(id, "ID")}`);
      }
    expect(new Set(answers)).toEqual(new Set(["E_NOT_FOUND no agent agent:ID"]));
  });

  it("shows an agent that ended an hour ago as team_overview does, offline, without saying it ended", async () => {
    const r = await samSends({ to: `agent:${ids["ended-recently"]}` });
    expect(r.out.code).toBe("E_UNREACHABLE");
    expect(r.out.message).toContain("that session is offline (last seen 1 h ago)");
    expect(r.out.message).not.toMatch(/ended/);
  });
});

describe("what a successful send shows", () => {
  it("gives the same answer for an online and an offline recipient when allow_offline is set", async () => {
    const online = await samSends({ to: "@lea", allow_offline: true });
    const offline = await samSends({ to: "@malik", allow_offline: true });
    expect(online.isError).toBe(false);
    expect(offline.isError).toBe(false);
    expect(Object.keys(online.out).sort()).toEqual(Object.keys(offline.out).sort());
    expect(online.out.reach).toBeUndefined();
  });

  it("gives no reach on an idempotent replay", async () => {
    const first = await samSends({ to: "@lea", idempotency_key: "replay-1" });
    expect(first.out.reach).toHaveLength(1);
    const again = await samSends({ to: "@lea", idempotency_key: "replay-1" });
    expect(again.out.id).toBe(first.out.id);
    expect(again.out.reach).toBeUndefined();
  });
});

describe("a guest", () => {
  it("learns nothing about who is online: no error, no reach", async () => {
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    const online = await send({ to: "@lea" }, team.malik.token);
    const offline = await send({ to: "@sam", kind: "question" }, team.malik.token);
    expect(online.isError).toBe(false);
    expect(offline.isError).toBe(false);
    expect(online.out.reach).toBeUndefined();
    expect(offline.out.reach).toBeUndefined();
  });
});
