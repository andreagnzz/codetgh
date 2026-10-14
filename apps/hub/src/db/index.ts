import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

// Postgres when DATABASE_URL is set, embedded PGlite otherwise; one schema and one SQL dialect for both.
// Sessions run in UTC: drizzle reads `timestamp` columns as UTC, so defaultNow() must write UTC too.
// loadDataDir: start PGlite from an already-migrated data directory (tests: initdb costs seconds, a load does not).
export async function openDb(opts: { databaseUrl?: string; dataDir: string; loadDataDir?: Blob }) {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, options: "-c timezone=UTC" });
    const db = drizzlePg(pool, { schema });
    const client = await pool.connect();
    try {
      // Several hub replicas may start together; only one migrates at a time.
      await client.query("select pg_advisory_lock(7231)");
      await migratePg(drizzlePg(client, { schema }), { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock(7231)");
      client.release();
    }
    return { db: db as unknown as Db, close: () => pool.end(), pglite: null };
  }
  const pglite = new PGlite(opts.dataDir, opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : undefined);
  await pglite.exec("set time zone 'UTC'");
  const db = drizzleLite(pglite, { schema });
  await migrateLite(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => pglite.close(), pglite };
}
