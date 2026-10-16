import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

// Hooks run in parallel: a reader must never see a half-written state file, or it starts over from {} (caps, ETag lost).
it("replaces the state file with a rename, never rewriting it in place", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const file = stateFile(env.CODETGH_STATE_DIR, "sam-atomic");
  writeFileSync(file, JSON.stringify({ etag: "e0" }));
  const before = statSync(file, { bigint: true }).ino;
  await runHook("post-edit", { session_id: "sam-atomic", tool_name: "Edit", tool_input: { file_path: join(tmpdir(), "x.ts") } }, env);
  expect(statSync(file, { bigint: true }).ino).not.toBe(before);
  expect(JSON.parse(readFileSync(file, "utf8")).etag).toBe("e0");
  expect(readdirSync(env.CODETGH_STATE_DIR)).toEqual([file.slice(env.CODETGH_STATE_DIR.length + 1)]);
});

// The slow git stand-in is an sh script: execFile on Windows runs no script without a shell.
it.skipIf(process.platform === "win32")("keeps both hooks' fields when one saves while the other waits on git", async () => {
  await startSession(hub.url, team.sam.token, "sam-race", { repo: ACME_REPO });
  await call(await mcpClient(hub.url, team.lea.token), "send_message", { to: "@sam", kind: "note", body: "race" });
  const repo = mkdtempSync(join(tmpdir(), "codetgh-race-repo-"));
  const bin = mkdtempSync(join(tmpdir(), "codetgh-race-git-"));
  // Plain sh, no node start: it must answer inside the hook's 500 ms git timeout even on a busy machine.
  writeFileSync(join(bin, "git"), `#!/bin/sh\nsleep 0.2\necho '${repo}'\n`, { mode: 0o755 });
  const env = hookEnv(hub.url, team.sam.token);
  await Promise.all([
    runHook(
      "pre-edit",
      { session_id: "sam-race", cwd: repo, tool_name: "Edit", tool_input: { file_path: join(repo, "a.ts") } },
      { ...env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    ),
    runHook("user-prompt-submit", { session_id: "sam-race", prompt: "go" }, env),
  ]);
  const state = JSON.parse(readFileSync(stateFile(env.CODETGH_STATE_DIR, "sam-race"), "utf8"));
  expect(state.etag).toBeTruthy();
  expect(state.root).toBeTruthy();
});
