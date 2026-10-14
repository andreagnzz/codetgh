import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-sl", { repo: ACME_REPO });
});
afterAll(() => hub.stop());

// Fullwidth letters fold back to ASCII when the envelope is rendered (NFKC): the scan must see what the reader sees.
const fullwidth = (s: string) => s.replace(/[A-Za-z0-9_]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0xfee0));
const KEY = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;

it("blocks a secret written in look-alike characters", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  for (const [tool, args] of [
    ["send_message", { to: "@lea", kind: "note", body: `the key is ${fullwidth(KEY)}` }],
    ["task_create", { title: `deploy with ${fullwidth(KEY)}` }],
  ] as const) {
    const r = await call(sam, tool, args);
    expect(r.isError, tool).toBe(true);
    expect(JSON.parse(r.text).code, tool).toBe("E_SECRET_BLOCKED");
  }
});
