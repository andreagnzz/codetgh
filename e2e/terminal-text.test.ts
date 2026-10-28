import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { type Keyring, program } from "../packages/cli/src/main.js";
import { hubRest } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-terminal-"));
});
afterAll(() => hub.stop());

async function cli(token: string, args: string[]) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = token;
  try {
    await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", ...args]);
  } finally {
    delete process.env.CODETGH_URL;
    delete process.env.CODETGH_TOKEN;
  }
  return out.join("\n");
}

// A teammate's words on the reader's terminal: an escape sequence could clear it, forge a line or write the clipboard.
it("prints a teammate's message in codetgh inbox without control characters or escape sequences", async () => {
  const body = "ok\u001b[2J\u001b]52;c;aGk=\u0007\r\u009b31mforged line\nsecond\tline";
  expect(
    (await hubRest(hub.url, team.sam.token, "POST", "/v1/messages", { to: "@lea", kind: "note", body, allow_offline: true })).status,
  ).toBe(200);
  const out = await cli(team.lea.token, ["inbox"]);
  expect(out).toContain("forged line\nsecond\tline");
  expect(out).not.toMatch(/[^\P{Cc}\n\t]/u);
  expect(out).not.toMatch(/\[2J|31m/);
});
