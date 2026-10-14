import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index.js";

// One migrated PGlite data directory per test run: each test hub loads it instead of running initdb and the migrations.
export default async function setup() {
  if (process.env.TEST_DATABASE_URL) return;
  const dir = mkdtempSync(join(tmpdir(), "codetgh-pglite-"));
  const file = join(dir, "template.tar");
  const { pglite, close } = await openDb({ dataDir: "memory://" });
  if (!pglite) throw new Error("the test template needs PGlite");
  writeFileSync(file, Buffer.from(await (await pglite.dumpDataDir("none")).arrayBuffer()));
  await close();
  process.env.CODETGH_TEST_PGLITE_TEMPLATE = file;
  return () => rmSync(dir, { recursive: true, force: true });
}
