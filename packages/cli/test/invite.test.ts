import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-invite-"));
});
afterAll(() => hub.stop());
afterEach(() => {
  delete process.env.CODETGH_URL;
  delete process.env.CODETGH_TOKEN;
});

async function cli(token: string, args: string[]) {
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = token;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", ...args]);
  return out.join("\n");
}

it("gives an admin a 7-day invitation link that opens the sign-up page", async () => {
  const out = await cli(team.lea.token, ["invite", "nina@acme.test"]);
  const link = out.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/)?.[0] ?? "";
  expect(link.startsWith(`${hub.url}/invite/`)).toBe(true);
  expect(out).toContain("valid 7 days");
  expect(out).toContain("nina@acme.test");
  expect((await fetch(link)).status).toBe(200);
  // codetgh setup opens it with the member's display name filled in, escaped.
  expect(await (await fetch(`${link}?name=${encodeURIComponent('Nina "R"')}`)).text()).toContain('value="Nina &quot;R&quot;"');
});

it("invites with a role, but only an owner invites owners", async () => {
  expect(await cli(team.lea.token, ["invite", "omar@acme.test", "--role", "guest"])).toContain("as guest");
  await expect(cli(team.lea.token, ["invite", "x@acme.test", "--role", "boss"])).rejects.toThrow(/member, admin, guest or owner/);
});

it("tells a member to ask an admin, and checks the address", async () => {
  await expect(cli(team.sam.token, ["invite", "z@acme.test"])).rejects.toThrow(/ask an admin/);
  await expect(cli(team.lea.token, ["invite", "not-an-email"])).rejects.toThrow(/email/);
});
