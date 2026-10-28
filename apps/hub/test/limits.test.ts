import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/domain/limits.js";
import { consolePost } from "../../../e2e/helpers.js";
import { call, mcpClient, startHub } from "./harness.js";

describe("rate limiter (30/min, 600/h, burst 10)", () => {
  it("allows a burst of 10 then asks to wait", () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < 10; i++) expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
    expect(limiter.take("b")).toBe(0);
  });

  it("refills at 30 per minute", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    let sent = 0;
    for (; now < 120_000; now += 500) if (limiter.take("a") === 0) sent++;
    expect(sent).toBeLessThanOrEqual(10 + 60);
    expect(sent).toBeGreaterThanOrEqual(60);
  });

  it("caps an hour at 600", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    let sent = 0;
    for (; now < 3_599_000; now += 1000) if (limiter.take("a") === 0) sent++;
    expect(sent).toBe(600);
    expect(sent).toBeLessThanOrEqual(600);
    expect(limiter.take("a")).toBeGreaterThan(0);
  });
});

describe("message budgets", () => {
  it("scales a budget: a team's is ten people's", () => {
    const limiter = new RateLimiter(() => 0);
    for (let i = 0; i < 100; i++) expect(limiter.take("team", 10)).toBe(0);
    expect(limiter.take("team", 10)).toBeGreaterThan(0);
  });

  it("takes the person's and the team's budget for every send, from an agent or from the console", async () => {
    const taken: string[] = [];
    class Spy extends RateLimiter {
      override take(key: string, scale?: number) {
        taken.push(key);
        return super.take(key, scale);
      }
    }
    const hub = await startHub({ limiter: new Spy() });
    const team = await hub.seed();
    const lea = await mcpClient(hub.url, team.lea.token);
    const sent = JSON.parse((await call(lea, "send_message", { to: "@sam", kind: "note", body: "hi", allow_offline: true })).text);
    expect(taken).toEqual(expect.arrayContaining([`user:${team.lea.userId}`, `team:${team.teamId}`]));
    taken.length = 0;
    expect((await consolePost(hub.url, team.sam.cookie, `/console/threads/${sent.thread}/reply`, { body: "back" })).status).toBe(204);
    expect(taken).toEqual(expect.arrayContaining([`user:${team.sam.userId}`, `team:${team.teamId}`]));
    await lea.close();
    await hub.stop();
  });
});
