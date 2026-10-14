import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeGithubToken, hookEnv, runHook } from "./helpers.js";

// A server that accepts connections and never answers.
let blackHole: Server;
let blackHolePort = 0;
const sockets = new Set<Socket>();
beforeAll(async () => {
  blackHole = createServer((s) => {
    sockets.add(s);
  });
  await new Promise<void>((resolve) => blackHole.listen(0, resolve));
  blackHolePort = (blackHole.address() as { port: number }).port;
});
afterAll(() => {
  for (const s of sockets) s.destroy();
  return new Promise<void>((resolve) => blackHole.close(() => resolve()));
});

describe.each([
  ["dead port", () => "http://127.0.0.1:1"],
  ["black hole", () => `http://127.0.0.1:${blackHolePort}`],
])("hub unreachable: %s (scenario 5)", (_, url) => {
  it("keeps every hook within budget, fails open and warns once per session", async () => {
    const env = hookEnv(url(), "ctgh_any");
    const session = { session_id: "down-1" };
    const runs = [
      ["session-start", { ...session, source: "startup" }, 5000],
      ["user-prompt-submit", { ...session, prompt: "a" }, 3000],
      ["user-prompt-submit", { ...session, prompt: "b" }, 3000],
      ["user-prompt-submit", { ...session, prompt: "c" }, 3000],
      ["pre-tool-use", { ...session, tool_name: "mcp__plugin_codetgh_hub__send_message", tool_input: { body: "clean text" } }, 3000],
      ["pre-edit", { ...session, tool_name: "Edit", tool_input: { file_path: "/tmp/x.ts" } }, 3000],
      ["post-edit", { ...session, tool_name: "Edit", tool_input: { file_path: "/tmp/x.ts" } }, 2000],
      ["stop", session, 3000],
      ["session-end", session, 2000],
    ] as const;
    let warnings = 0;
    for (const [event, input, budget] of runs) {
      const r = await runHook(event, input, env);
      expect(r.code).toBe(0);
      expect(r.ms, `${event} took ${r.ms} ms`).toBeLessThan(budget);
      if (r.out && "systemMessage" in r.out) warnings++;
    }
    expect(warnings).toBe(1);

    const deny = await runHook(
      "pre-tool-use",
      { ...session, tool_name: "mcp__plugin_codetgh_hub__send_message", tool_input: { body: `key ${fakeGithubToken()}` } },
      env,
    );
    expect((deny.out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision).toBe("deny");
  });
});
