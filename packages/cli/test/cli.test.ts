import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../../../apps/hub/test/harness.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-cli-"));
});
afterAll(() => hub.stop());

function fakeKeyring(): Keyring & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (u) => store.get(u) ?? null,
    set: (u, t) => {
      store.set(u, t);
    },
    delete: (u) => {
      store.delete(u);
    },
  };
}

async function run(args: string[], keyring: Keyring, stdin = "") {
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([stdin]) };
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

it("logs in with a token from stdin and keeps it in the keychain only", async () => {
  const keyring = fakeKeyring();
  const { out } = await run(["login", "--url", hub.url, "--token-stdin"], keyring, team.sam.token);
  expect(out).toContain("Logged in as Sam (@sam, member) in Acme web.");
  expect(keyring.store.get(hub.url)).toBe(team.sam.token);
});

it("refuses a wrong token", async () => {
  await expect(run(["login", "--url", hub.url, "--token-stdin"], fakeKeyring(), "ctgh_wrong")).rejects.toThrow(/401/);
});

it("never sends the token to a plain-http hub outside this machine", async () => {
  const keyring = fakeKeyring();
  await expect(run(["login", "--url", "http://hub.example.com", "--token-stdin"], keyring, team.sam.token)).rejects.toThrow(/https/);
  expect(keyring.store.size).toBe(0);
});
