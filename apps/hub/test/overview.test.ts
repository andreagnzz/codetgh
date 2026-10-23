import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, auditEvent, claim } from "../src/db/schema.js";
import { expireStaleSessions } from "../src/domain/agents.js";
import { newId } from "../src/ids.js";
import { ACME_REPO, type Hub, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const BILLING = repoFingerprint("git@github.com:acme/billing.git");
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const ids: Record<string, string> = {};

// The field report: every restart made a new agent, 13 for 2 people, 6 of them not seen for over 12 hours.
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  const plan = [
    ["lea-1", team.lea.token, ACME_REPO, 0],
    ["lea-2", team.lea.token, ACME_REPO, 0],
    ["lea-3", team.lea.token, BILLING, 0],
    ["lea-4", team.lea.token, ACME_REPO, 0],
    ["lea-5", team.lea.token, ACME_REPO, 13],
    ["lea-6", team.lea.token, ACME_REPO, 20],
    ["lea-7", team.lea.token, BILLING, 30],
    ["sam-1", team.sam.token, ACME_REPO, 0],
    ["sam-2", team.sam.token, ACME_REPO, 0],
    ["sam-3", team.sam.token, ACME_REPO, 2],
    ["sam-4", team.sam.token, ACME_REPO, 13],
    ["sam-5", team.sam.token, ACME_REPO, 14],
    ["sam-6", team.sam.token, BILLING, 40],
  ] as const;
  for (const [session, token, repo, age] of plan) {
    ids[session] = (await startSession(hub.url, token, session, { repo })).agent_id ?? "";
    if (age)
      await hub.db
        .update(agent)
        .set({ lastSeenAt: hoursAgo(age) })
        .where(eq(agent.id, ids[session] ?? ""));
  }
});
afterAll(() => hub.stop());

describe("stale sessions", () => {
  it("ends the session agents not seen for 12 hours, as at SessionEnd, keeps their rows and audits each", async () => {
    // Sam's CLI agent (cli-…), unseen as long, is not a session: it stays.
    await fetch(`${hub.url}/v1/status`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
    await hub.db
      .update(agent)
      .set({ lastSeenAt: hoursAgo(20) })
      .where(and(eq(agent.userId, team.sam.userId), like(agent.sessionId, "cli-%")));
    const claimOf = (holder: string, mode: "intent" | "exclusive") => ({
      id: newId("clm"),
      teamId: team.teamId,
      holderUserId: team.lea.userId,
      holderAgentId: holder,
      scopeType: "path" as const,
      scope: `src/${mode}.ts`,
      mode,
      ttlS: 86400,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const intent = claimOf(ids["lea-5"] ?? "", "intent");
    const exclusive = claimOf(ids["lea-5"] ?? "", "exclusive");
    await hub.db.insert(claim).values([intent, exclusive]);
    const before = (await hub.db.select().from(agent)).length;

    await expireStaleSessions(hub.db);

    const stale = ["lea-5", "lea-6", "lea-7", "sam-4", "sam-5", "sam-6"].map((s) => ids[s] ?? "");
    const rows = await hub.db.select().from(agent);
    expect(rows).toHaveLength(before);
    expect(rows.filter((r) => r.endedAt).map((r) => r.id)).toEqual(expect.arrayContaining(stale));
    expect(rows.filter((r) => r.endedAt)).toHaveLength(6);
    expect(rows.find((r) => r.id === ids["sam-3"])?.endedAt).toBeNull();
    const audits = await hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "agent.session_expired"), inArray(auditEvent.subjectId, stale)));
    expect(audits).toHaveLength(6);
    expect(audits.every((a) => a.actorType === "hub" && a.via === "system")).toBe(true);
    // Intent claims end with the session; exclusive ones run until their TTL.
    const claims = await hub.db
      .select()
      .from(claim)
      .where(inArray(claim.id, [intent.id, exclusive.id]));
    expect(claims.find((c) => c.id === intent.id)?.releaseReason).toBe("session_end");
    expect(claims.find((c) => c.id === exclusive.id)?.releasedAt).toBeNull();
    // A second run finds nothing more to end.
    await expireStaleSessions(hub.db);
    expect((await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "agent.session_expired"))).length).toBe(6);
  });
});
