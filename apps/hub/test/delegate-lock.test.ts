import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { agent } from "../src/db/schema.js";
import { ACME_REPO, auth, startHub } from "./harness.js";

// Postgres only (pnpm test:pg): PGlite runs one transaction at a time, so it cannot hold a lock while the hub waits on it.
describe.runIf(process.env.TEST_DATABASE_URL)("delegate opt-in and the receiver's role change one at a time", () => {
  it("waits for a role change in progress, then reads the new role and refuses the opt-in", async () => {
    const hub = await startHub();
    const team = await hub.seed();
    // An admin's changeRole to guest, caught between its lock and its commit.
    const admin = new pg.Client({ connectionString: hub.config.databaseUrl });
    await admin.connect();
    await admin.query("begin");
    await admin.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`delegates:${team.teamId}`]);
    await admin.query("update membership set role = 'guest' where user_id = $1", [team.sam.userId]);
    let answered = false;
    const registering = fetch(`${hub.url}/v1/agents/session`, {
      method: "POST",
      headers: auth(team.sam.token),
      body: JSON.stringify({ session_id: "sam-race", source: "startup", repo_fingerprint: ACME_REPO, accept_requests_from: ["@lea"] }),
    }).then((r) => {
      answered = true;
      return r;
    });
    await sleep(500);
    expect(answered).toBe(false);
    await admin.query("commit");
    await admin.end();
    expect((await registering).status).toBe(403);
    const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-race"));
    expect(row?.acceptRequestsFrom ?? null).toBeNull();
    await hub.stop();
  });
});
