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

// receipt.message_id is a cascading foreign key: without an index, deleting a message scans every receipt.
it("indexes the column that receipts reference their message by", async () => {
  const { db, close } = await openDb({ dataDir: mkdtempSync(join(tmpdir(), "codetgh-db-")) });
  const res = (await db.execute(sql`select indexdef from pg_indexes where tablename = 'receipt'`)) as unknown as {
    rows: Array<{ indexdef: string }>;
  };
  expect(res.rows.some((r) => /\(message_id[,)]/.test(r.indexdef))).toBe(true);
  await close();
});
