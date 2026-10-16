import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBot } from "../src/bot.js";

// A key pair standing in for Discord's: the bot only knows the public half, as in production.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
const signed = (body: string, timestamp = String(Math.floor(Date.now() / 1000))) => ({
  body,
  headers: {
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), privateKey).toString("hex"),
  },
});
const bot = createBot({ publicKey: publicHex, repo: "andreagnzz/codetgh", ciStatus: async () => "CI on main: success (abc1234)" });
const command = (name: string) => JSON.stringify({ type: 2, data: { name } });

describe("Discord interactions", () => {
  it("answers Discord's PING only when the signature is valid", async () => {
    const ok = signed(JSON.stringify({ type: 1 }));
    expect(await bot.handle(ok.body, ok.headers)).toEqual({ status: 200, body: { type: 1 } });
    const forged = { ...ok.headers, "x-signature-ed25519": "00".repeat(64) };
    expect((await bot.handle(ok.body, forged)).status).toBe(401);
    expect((await bot.handle(ok.body, {})).status).toBe(401);
    // A valid signature on a different body is still refused.
    expect((await bot.handle(JSON.stringify({ type: 1, x: 1 }), ok.headers)).status).toBe(401);
    // A captured request replayed more than 5 minutes later is refused, though its signature still holds.
    const old = signed(JSON.stringify({ type: 1 }), String(Math.floor(Date.now() / 1000) - 301));
    expect((await bot.handle(old.body, old.headers)).status).toBe(401);
  });

  it("answers the project's commands, with no mentions allowed", async () => {
    for (const [name, text] of [
      ["install", "npm install -g"],
      ["docs", "https://github.com/andreagnzz/codetgh"],
      ["bug", "/issues/new"],
      ["security", "/security/advisories/new"],
      ["status", "CI on main: success (abc1234)"],
    ]) {
      const req = signed(command(name));
      const res = await bot.handle(req.body, req.headers);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ type: 4, data: { allowed_mentions: { parse: [] } } });
      expect(JSON.stringify(res.body)).toContain(text);
    }
  });

  it("says when a command is unknown", async () => {
    const req = signed(command("rm"));
    expect(JSON.stringify((await bot.handle(req.body, req.headers)).body)).toContain("Unknown command");
  });
});
