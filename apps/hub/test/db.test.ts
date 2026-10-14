import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { openDb } from "../src/db/index.js";

// Drizzle reads `timestamp` columns as UTC, so defaultNow() must run in a UTC session whatever the server's zone.
it("runs every database session in UTC", async () => {
  const { db, close } = await openDb({ dataDir: mkdtempSync(join(tmpdir(), "codetgh-db-")) });
  const res = (await db.execute(sql`select current_setting('TimeZone') as tz`)) as unknown as { rows: Array<{ tz: string }> };
  expect(res.rows[0]?.tz).toBe("UTC");
  await close();
});
