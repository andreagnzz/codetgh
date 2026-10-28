import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { agent, membership } from "../src/db/schema.js";
import { ACME_REPO, auth, type Hub, startHub, startSession } from "./harness.js";

type Team = Awaited<ReturnType<Hub["seed"]>>;

// One of the writers caught between its lock and its commit: a raw client holds the team's delegates lock. It always ends
// that transaction and stops the hub, so a failed expect cannot leave the suite waiting on the lock.
async function whileLocked(run: (hub: Hub, team: Team, holder: pg.Client) => Promise<void>) {
  const hub = await startHub();
  const holder = new pg.Client({ connectionString: hub.config.databaseUrl });
  try {
    const team = await hub.seed();
    await holder.connect();
    await holder.query("begin");
    await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`delegates:${team.teamId}`]);
    await run(hub, team, holder);
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end().catch(() => {});
    await hub.stop();
  }
}

// Whether the call is still unanswered after half a second.
async function waiting(call: Promise<unknown>) {
  let answered = false;
  const done = () => {
    answered = true;
  };
  call.then(done, done);
  await sleep(500);
  return !answered;
}

// Postgres only (pnpm test:pg): PGlite runs one transaction at a time, so it cannot hold a lock while the hub waits on it.
describe.runIf(process.env.TEST_DATABASE_URL)("delegate opt-ins, roles and trust change one at a time", () => {
  it("waits for a role change in progress, then reads the new role and refuses the opt-in", () =>
    whileLocked(async (hub, team, holder) => {
      await holder.query("update membership set role = 'guest' where user_id = $1", [team.sam.userId]);
      const registering = fetch(`${hub.url}/v1/agents/session`, {
        method: "POST",
        headers: auth(team.sam.token),
        body: JSON.stringify({ session_id: "sam-race", source: "startup", repo_fingerprint: ACME_REPO, accept_requests_from: ["@lea"] }),
      });
      expect(await waiting(registering)).toBe(true);
      await holder.query("commit");
      expect((await registering).status).toBe(403);
      const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-race"));
      expect(row?.acceptRequestsFrom ?? null).toBeNull();
    }));

  it("holds a role change while the lock is taken", () =>
    whileLocked(async (hub, team, holder) => {
      const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
      const changing = consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/role`, { role: "guest" });
      expect(await waiting(changing)).toBe(true);
      await holder.query("rollback");
      expect((await changing).status).toBe(204);
    }));

  it("holds a quarantine while the lock is taken", () =>
    whileLocked(async (hub, team, holder) => {
      const sam = (await startSession(hub.url, team.sam.token, "sam-trust", { repo: ACME_REPO })).agent_id;
      const quarantining = consolePost(hub.url, team.lea.cookie, `/console/agents/${sam}/quarantined`);
      expect(await waiting(quarantining)).toBe(true);
      await holder.query("rollback");
      expect((await quarantining).status).toBe(204);
    }));
});
