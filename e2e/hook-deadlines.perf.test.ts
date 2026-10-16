import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fakeCommand, gitRepo, hookEnv, runHook } from "./helpers.js";

// A hub that answers every request, but only after a delay: each call alone fits its timeout, the sum does not.
const DELAYS: Record<string, number> = { "/v1/agents/session": 2300, "/v1/claims/pre-edit": 4000, "/v1/claims/check": 4000 };
let slow: Server;
let url = "";
beforeAll(async () => {
  slow = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ context: "slow hub context", paused: false, linked: true, decision: "deny", reason: "x", paths: [] }));
    }, DELAYS[path] ?? 0);
  });
  await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(slow.address() as { port: number }).port}`;
});
afterAll(() => {
  slow.closeAllConnections();
  return new Promise<void>((resolve) => slow.close(() => resolve()));
});

it("session-start stays within its 5 s limit when the CLI and both registrations are slow, and keeps the first answer", async () => {
  const repo = gitRepo();
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "x"]);
  const bin = mkdtempSync(join(tmpdir(), "codetgh-slow-claude-"));
  fakeCommand(bin, "claude", 'setTimeout(() => console.log("2.1.299 (Claude Code)"), 900);\n');
  const env = { ...hookEnv(url, "ctgh_any"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  const r = await runHook("session-start", { session_id: "slow-start", source: "clear", cwd: repo }, env);
  expect(r.code).toBe(0);
  expect(r.ms, `session-start took ${r.ms} ms`).toBeLessThan(4800);
  expect((r.out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext).toBe("slow hub context");
});

// The slow git stand-in is an sh script: execFile on Windows runs no script without a shell.
it.skipIf(process.platform === "win32")(
  "pre-edit and stop share one deadline between a slow git and a slow hub, and fail open",
  async () => {
    const repo = mkdtempSync(join(tmpdir(), "codetgh-slow-repo-"));
    const bin = mkdtempSync(join(tmpdir(), "codetgh-slow-git-"));
    // Each answer lands just inside its own git timeout (500 ms, 1000 ms for status).
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = status ]; then sleep 0.9; printf ' M src/a.ts\\0'; else sleep 0.4; echo '${repo}'; fi\n`,
      { mode: 0o755 },
    );
    const env = { ...hookEnv(url, "ctgh_any"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
    const edit = await runHook(
      "pre-edit",
      { session_id: "slow-edit", cwd: repo, tool_name: "Edit", tool_input: { file_path: join(repo, "src/a.ts") } },
      env,
    );
    expect(edit.code).toBe(0);
    expect(edit.out).toBeNull();
    expect(edit.ms, `pre-edit took ${edit.ms} ms`).toBeLessThan(2800);
    const stop = await runHook("stop", { session_id: "slow-edit", cwd: repo }, env);
    expect(stop.code).toBe(0);
    expect(stop.out).toBeNull();
    expect(stop.ms, `stop took ${stop.ms} ms`).toBeLessThan(2800);
  },
);
