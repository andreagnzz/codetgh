import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, auditEvent, claim, project } from "../src/db/schema.js";
import { expireStaleSessions } from "../src/domain/agents.js";
import { newId } from "../src/ids.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const BILLING = repoFingerprint("git@github.com:acme/billing.git");
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const ids: Record<string, string> = {};
let billing = "";

type Session = { agent: string; project: string; presence: string; usage?: unknown };
type Person = { handle: string; status: string; status_age_s: number | null; last_seen: string | null; sessions: Session[] };
type Overview = { people: Person[]; trust: string; claims?: unknown[]; you: { handle: string; usage?: unknown } };
const overview = async (token: string, args: Record<string, unknown> = {}) => {
  const client = await mcpClient(hub.url, token);
  const r = await call(client, "team_overview", args);
  await client.close();
  return { text: r.text, ov: JSON.parse(r.text) as Overview };
};
const person = (ov: Overview, handle: string) => ov.people.find((p) => p.handle === handle);

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
  billing = (await hub.db.select({ id: project.id }).from(project).where(eq(project.repoFingerprint, BILLING)))[0]?.id ?? "";
  // Léa's plan usage, as her presence mod reports it.
  await fetch(`${hub.url}/v1/status?session_id=lea-1&five_hour=42`, { headers: { Authorization: `Bearer ${team.lea.token}` } });
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

describe("team_overview by person", () => {
  it("lists 2 people, only their live sessions, and their usage once", async () => {
    const { ov, text } = await overview(team.sam.token);
    expect(ov.people.map((p) => p.handle).sort()).toEqual(["lea", "sam"]);
    expect(
      person(ov, "lea")
        ?.sessions.map((s) => s.agent)
        .sort(),
    ).toEqual(["lea-1", "lea-2", "lea-3", "lea-4"].map((s) => ids[s]).sort());
    // Sam calls with several live sessions, so from his auto agent: his own sessions are listed, never the caller.
    expect(
      person(ov, "sam")
        ?.sessions.map((s) => s.agent)
        .sort(),
    ).toEqual(["sam-1", "sam-2"].map((s) => ids[s]).sort());
    expect(person(ov, "lea")?.sessions.every((s) => s.presence !== "offline" && !("usage" in s))).toBe(true);
    expect(text.match(/"five_hour"/g)).toHaveLength(1);
    expect(person(ov, "lea")).toMatchObject({ usage: { five_hour: { pct: 42 } }, open_tasks: { claimed: 0, in_progress: 0 } });
    expect(ov.you.handle).toBe("sam");
    expect(ov.trust).toMatch(/^untrusted-peer: /);
    expect(text).not.toContain("<peer_message");
  });

  it("lists offline people once, with no session, when online_only is false", async () => {
    expect(person((await overview(team.sam.token)).ov, "malik")).toBeUndefined();
    const { ov } = await overview(team.sam.token, { online_only: false });
    expect(person(ov, "malik")).toMatchObject({ sessions: [], last_seen: null });
    expect(person(ov, "lea")?.sessions).toHaveLength(4);
  });

  it("filters by handle and by project, the caller's or a named one", async () => {
    expect((await overview(team.sam.token, { handle: "@lea" })).ov.people.map((p) => p.handle)).toEqual(["lea"]);
    const named = (await overview(team.sam.token, { project: billing })).ov;
    expect(named.people.map((p) => p.handle)).toEqual(["lea"]);
    expect(person(named, "lea")?.sessions.map((s) => s.agent)).toEqual([ids["lea-3"]]);
    const current = (await overview(team.sam.token, { agent: ids["sam-1"], project: "current" })).ov;
    expect(
      person(current, "lea")
        ?.sessions.map((s) => s.agent)
        .sort(),
    ).toEqual(["lea-1", "lea-2", "lea-4"].map((s) => ids[s]).sort());
    expect(person(current, "sam")?.sessions.map((s) => s.agent)).toEqual([ids["sam-2"]]);
  });

  it("keeps people and live sessions only when compact", async () => {
    const { ov, text } = await overview(team.sam.token, { compact: true });
    expect(person(ov, "lea")?.sessions).toHaveLength(4);
    expect(text).not.toContain("usage");
    expect(ov.claims).toBeUndefined();
  });

  it("shows the latest status_set past its expiry, escaped on one line, with its age, as the console does", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect((await call(lea, "status_set", { agent: ids["lea-2"], text: "deploy <script>x</script>\nnow", ttl_s: 60 })).isError).toBe(false);
    await lea.close();
    await hub.db
      .update(agent)
      .set({ statusSetAt: hoursAgo(3), statusExpiresAt: hoursAgo(1) })
      .where(eq(agent.id, ids["lea-2"] ?? ""));
    const lp = person((await overview(team.sam.token)).ov, "lea");
    expect(lp?.status).toBe("deploy &lt;script&gt;x&lt;/script&gt; now");
    expect(lp?.status_age_s).toBeGreaterThanOrEqual(10_790);
    expect(lp?.status_age_s).toBeLessThan(10_900);
    // The dashboard's presence list: the same text, and when it was set.
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie: team.sam.cookie } })).text();
    expect(html).toContain("deploy &lt;script&gt;x&lt;/script&gt; now");
    expect(html).toContain(`datetime="${hoursAgo(3).toISOString().slice(0, 13)}`);
  });
});
