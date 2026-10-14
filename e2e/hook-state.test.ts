import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const stateFile = (dir: string, session: string) =>
  join(dir, `codetgh-${createHash("sha256").update(session).digest("hex").slice(0, 16)}.json`);

// On a shared machine /tmp is everyone's: another user could plant a session's state file there.
it.skipIf(process.platform === "win32")("keeps session state in a private per-user directory, not in /tmp", async () => {
  const session = `sam-private-${Date.now()}`;
  await startSession(hub.url, team.sam.token, session, { repo: ACME_REPO });
  // Something to deliver, so the prompt hook records the delivery in its state.
  await call(await mcpClient(hub.url, team.lea.token), "send_message", { to: "@sam", kind: "note", body: "hello" });
  const runtime = mkdtempSync(join(tmpdir(), "codetgh-runtime-"));
  const { CODETGH_STATE_DIR: _, ...env } = hookEnv(hub.url, team.sam.token);
  await runHook("user-prompt-submit", { session_id: session, prompt: "go" }, { ...env, XDG_RUNTIME_DIR: runtime });
  const dir = join(runtime, "codetgh");
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  expect(existsSync(stateFile(dir, session))).toBe(true);
  expect(existsSync(stateFile(tmpdir(), session))).toBe(false);
  // Without a session id there is no state at all, rather than one path shared by everyone.
  await runHook("session-start", { source: "startup" }, { ...env, XDG_RUNTIME_DIR: runtime, CODETGH_TOKEN: "" });
  expect(readdirSync(dir)).toEqual([`codetgh-${createHash("sha256").update(session).digest("hex").slice(0, 16)}.json`]);
});

it("ignores a rewake waiter left behind by a killed hook", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    push_hooks: "on",
    push_rewake: "on",
  });
  await startSession(hub.url, team.sam.token, "sam-stale", { repo: ACME_REPO });
  const env = { ...hookEnv(hub.url, team.sam.token), CLAUDE_PLUGIN_OPTION_PUSH_MODE: "rewake" };
  // A live pid (this test runner) recorded 11 minutes ago: the waiter was killed at its 600 s timeout.
  writeFileSync(stateFile(env.CODETGH_STATE_DIR, "sam-stale"), JSON.stringify({ waiter: process.pid, waiterAt: Date.now() - 11 * 60_000 }));
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(malik, "send_message", { to: "@sam", kind: "note", body: "are you there?" });
  expect((await runHook("rewake", { session_id: "sam-stale" }, env)).code).toBe(2);
});
