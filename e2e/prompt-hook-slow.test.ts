import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { hookEnv, runHook } from "./helpers.js";

// A hub that answers the prompt hook after `delayMs`, the way it did from a teammate's Windows PC (about 1 s per call
// plus Node's start-up there).
async function slowHub(delayMs: number) {
  const server = createServer((req, res) => {
    req.resume();
    setTimeout(
      () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ context: "<codetgh_messages/>" })),
      delayMs,
    ).unref();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
const line = (r: Awaited<ReturnType<typeof runHook>>) => String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");

it("still delivers a prompt's messages when the hub takes over two seconds", async () => {
  const hub = await slowHub(2200);
  const r = await runHook("user-prompt-submit", { session_id: "slow-prompt-1", prompt: "go" }, hookEnv(hub.url, "ctgh_test"));
  hub.close();
  expect(JSON.stringify(r.out)).toContain("<codetgh_messages/>");
});

it("says the hub is slow, not unreachable, when it does not answer in time", async () => {
  const hub = await slowHub(6000);
  const r = await runHook("user-prompt-submit", { session_id: "slow-prompt-2", prompt: "go" }, hookEnv(hub.url, "ctgh_test"));
  hub.close();
  expect(line(r)).not.toMatch(/unreachable/);
  expect(line(r)).toMatch(/slow/);
  expect(line(r)).toMatch(/next prompt/);
});

// The hooks that now report the session's activity stay inside their 3 s timeout against a hub that never answers in time:
// Stop sends its report next to the claims check, the tool poll rides on a call it already makes.
it("lets the Stop hook and the tool poll finish within 3 s when the hub is slow", async () => {
  const hub = await slowHub(6000);
  const env = { ...hookEnv(hub.url, "ctgh_test"), CODETGH_POLL_MS: "0" };
  const stop = await runHook("stop", { session_id: "slow-stop", prompt: "go" }, env);
  const poll = await runHook("inbox", { session_id: "slow-poll", tool_name: "Bash" }, env);
  hub.close();
  expect(stop.code).toBe(0);
  expect(stop.ms).toBeLessThan(3000);
  expect(poll.code).toBe(0);
  expect(poll.ms).toBeLessThan(3000);
});
