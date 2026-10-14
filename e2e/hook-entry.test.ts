import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookBundle, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

// A plugin root reached through a symlink (a linked home, macOS /var → /private/var) must not silence every hook.
it.skipIf(process.platform === "win32")("runs when started through a symlinked path", async () => {
  const link = join(mkdtempSync(join(tmpdir(), "codetgh-link-")), "hook.js");
  symlinkSync(hookBundle(), link);
  const r = await runHook(
    "session-start",
    { session_id: "sam-link", source: "startup", cwd: gitRepo() },
    hookEnv(hub.url, team.sam.token),
    link,
  );
  expect(r.raw).toContain("codetgh_context");
});
