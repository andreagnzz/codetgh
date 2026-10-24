import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { RateLimiter } from "../../../apps/hub/src/domain/limits.js";
import { sendMessage } from "../../../apps/hub/src/domain/messages.js";
import { principalForToken } from "../../../apps/hub/src/principal.js";
import { call, type Hub, mcpClient, startHub } from "../../../apps/hub/test/harness.js";
import { type Keyring, program } from "../src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-pause-"));
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
const agentSends = async (token: string) => {
  const c = await mcpClient(hub.url, token);
  const r = await call(c, "send_message", { to: "@lea", kind: "note", body: "status update", allow_offline: true });
  await c.close();
  return r;
};

it("pause stops my agents from sending, and only mine; resume brings them back", async () => {
  expect(await cli(team.sam.token, ["pause"])).toContain("paused");
  const refused = await agentSends(team.sam.token);
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("codetgh resume");
  expect((await agentSends(team.malik.token)).isError).toBe(false);
  expect(await cli(team.sam.token, ["status"])).toContain("your agents are paused");

  expect(await cli(team.sam.token, ["resume"])).toContain("resumed");
  expect((await agentSends(team.sam.token)).isError).toBe(false);
  expect(await cli(team.sam.token, ["status"])).not.toContain("paused");
});

it("still lets the person answer as a human while their agents are paused", async () => {
  await cli(team.lea.token, ["pause"]);
  const p = await principalForToken(hub.db, team.lea.token);
  if (!p) throw new Error("no principal");
  const sent = await sendMessage(
    { db: hub.db, bus: hub.bus, limiter: new RateLimiter(), secret: hub.config.secret },
    { p, agent: null, via: "console" },
    {
      to: "@sam",
      kind: "note",
      priority: "normal",
      refs: [],
      body: "I'll answer by hand today",
    },
  );
  expect(sent.authoredBy).toBe("human");
  await cli(team.lea.token, ["resume"]);
});
