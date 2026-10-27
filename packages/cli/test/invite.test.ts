import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createInvitation } from "../../../apps/hub/src/domain/teams.js";
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

it("sends admin and owner invitations to the console, and revokes only member and guest ones", async () => {
  const refusal = (args: string[]) =>
    cli(team.lea.token, args).then(
      () => "",
      (e: Error) => e.message,
    );
  await createInvitation(hub.db, { teamId: team.teamId, email: "pending@acme.test", role: "admin", invitedBy: null, via: "system" });
  // The hub's message is the whole answer: asking an admin to run the same command would send the person in a circle.
  for (const args of [
    ["invite", "adm@acme.test", "--role", "admin"],
    ["invite", "own@acme.test", "--role", "owner"],
    ["invite", "pending@acme.test", "--revoke"],
  ]) {
    const message = await refusal(args);
    expect(message).toMatch(/in the console, not with a token$/);
    expect(message).not.toContain("ask an admin");
  }
});

it("tells a member to ask an admin, and checks the address", async () => {
  await expect(cli(team.sam.token, ["invite", "z@acme.test"])).rejects.toThrow(/ask an admin/);
  await expect(cli(team.lea.token, ["invite", "not-an-email"])).rejects.toThrow(/email/);
});

it("sets how many days a link lasts, and revokes it", async () => {
  const out = await cli(team.lea.token, ["invite", "zoe@acme.test", "--days", "3"]);
  expect(out).toContain("valid 3 days");
  const link = out.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/)?.[0] ?? "";
  expect(await cli(team.lea.token, ["invite", "zoe@acme.test", "--revoke"])).toContain("Revoked 1 invitation");
  expect(await (await fetch(link)).text()).toContain("no longer valid");
  await expect(cli(team.lea.token, ["invite", "zoe@acme.test", "--days", "45"])).rejects.toThrow(/between 1 and 30 days/);
});
