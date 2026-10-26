import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { hookEnv, runHook, systemMessage } from "./helpers.js";

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
  expect(systemMessage(r)).not.toMatch(/unreachable/);
  expect(systemMessage(r)).toMatch(/slow/);
  expect(systemMessage(r)).toMatch(/next prompt/);
});
