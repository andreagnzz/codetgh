import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../../../apps/hub/test/harness.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-status-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_TOKEN;
});

async function cli(url: string, token: string, args: string[]) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = url;
  process.env.CODETGH_TOKEN = token;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", ...args]);
  return out.join("\n");
}

it("shows who is online, my unread messages and the live claims", async () => {
  await startSession(hub.url, team.sam.token, "sam-status", { branch: "feat/login", repo: ACME_REPO });
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(sam, "claim", { scope: ["api/login.ts"], mode: "exclusive", reason: "rewrite" });
  await call(sam, "send_message", { to: "@lea", kind: "question", body: "Can I change the login contract?" });
  await sam.close();

  const out = await cli(hub.url, team.lea.token, ["status"]);
  expect(out).toContain("Acme web, you are @lea");
  expect(out).toMatch(/Online: Sam @sam \(sam@feat\/login, online\)/);
  expect(out).toContain("Unread: 1 (1 question): codetgh inbox");
  expect(out).toMatch(/Claims: api\/login\.ts → @sam \(exclusive, \d+ min\)/);
  // Peer text is not shown here: only who, where and counts.
  expect(out).not.toContain("login contract");
  expect(out).not.toContain("rewrite");
});

it("says what to do when the hub cannot be reached", async () => {
  await expect(cli("http://127.0.0.1:9", team.lea.token, ["status"])).rejects.toThrow(/cannot reach the hub.*codetgh doctor/);
});
