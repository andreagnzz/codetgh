import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { startHub } from "./harness.js";

// Postgres only (pnpm test:pg): PGlite runs in-process and has no server to close a connection.
describe.runIf(process.env.TEST_DATABASE_URL)("Postgres connection loss", () => {
  it("survives the server closing its idle connections, and reconnects", async () => {
    const hub = await startHub();
    // Let better-auth finish its start-up writes (OAuth resources) before the connections go.
    expect((await fetch(`${hub.url}/.well-known/oauth-authorization-server`)).status).toBe(200);
    await hub.db.execute(sql`select 1`);
    const admin = new pg.Client({ connectionString: hub.config.databaseUrl });
    await admin.connect();
    const killed = await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()",
    );
    await admin.end();
    expect(killed.rowCount).toBeGreaterThan(0);
    await sleep(200);
    const [row] = (await hub.db.execute(sql`select 1 as ok`)).rows as Array<{ ok: number }>;
    expect(row?.ok).toBe(1);
    await hub.stop();
  });
});
