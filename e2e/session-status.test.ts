import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost, fakeCommand, gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let env: Record<string, string>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
  const bin = mkdtempSync(join(tmpdir(), "codetgh-fake-claude-"));
  fakeCommand(bin, "claude", 'if (process.argv[2] === "--version") console.log("2.1.299 (Claude Code)");\n');
  env = {
    ...hookEnv(hub.url, team.sam.token),
    CLAUDE_PLUGIN_OPTION_PUSH_MODE: "rewake",
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  };
});
afterAll(() => hub.stop());

const start = async (session: string) => {
  const r = await runHook("session-start", { session_id: session, source: "startup", cwd: repo }, env);
  return String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");
};

it("tells the person at startup that CodeTgh is on, with the push mode and Claude Code version", async () => {
  const line = await start("sam-status");
  expect(line).toMatch(/^CodeTgh ✓ acme\/webapp · @sam · push rewake · Claude Code 2\.1\.299 · \d+ online · \d+ unread/);
  // A new team allows rewake: nothing to warn about.
  expect(line).not.toContain("rewake is off");

  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-status"));
  expect(row?.pushMode).toBe("rewake");
  expect(row?.clientVersion).toBe("2.1.299");
});

it("warns once an admin turns rewake off", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    push_hooks: "on",
  });
  // The person learns it here instead of never being woken.
  expect(await start("sam-status-2")).toContain("rewake is off for this team");
});

it("shows each session's push mode and Claude Code version to the team in the console", async () => {
  const html = await (await fetch(`${hub.url}/console/agents`, { headers: { cookie: team.lea.cookie } })).text();
  expect(html).toContain("Push");
  expect(html).toContain("rewake");
  expect(html).toContain("2.1.299");
});

it("treats a push mode the plugin no longer offers (an old channel install) as hooks", async () => {
  const r = await runHook(
    "session-start",
    { session_id: "sam-legacy", source: "startup", cwd: repo },
    { ...env, CLAUDE_PLUGIN_OPTION_PUSH_MODE: "channel" },
  );
  expect(String((r.out as { systemMessage?: string } | null)?.systemMessage)).toContain("· push hooks ·");
  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-legacy"));
  expect(row?.pushMode).toBe("hooks");
});
