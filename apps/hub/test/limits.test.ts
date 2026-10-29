import { describe, expect, it } from "vitest";
import { consolePost, hubRest } from "../../../e2e/helpers.js";
import { membership, user } from "../src/db/schema.js";
import { RateLimiter } from "../src/domain/limits.js";
import { newId } from "../src/ids.js";
import { createPersonalToken } from "../src/tokens.js";
import { call, code, mcpClient, startHub } from "./harness.js";

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

  // A refused send takes nothing of the team's budget: else one person, a guest even, could stop every other send.
  it("leaves the team's budget alone when the person's budget refuses a send", async () => {
    const limiter = new RateLimiter(() => 0);
    const hub = await startHub({ limiter });
    const team = await hub.seed();
    const lea = await mcpClient(hub.url, team.lea.token);
    const sent = JSON.parse((await call(lea, "send_message", { to: "@sam", kind: "note", body: "hi", allow_offline: true })).text);
    // A busy day: the team has 20 sends left, and Sam keeps replying past his own 10.
    for (let i = 0; i < 79; i++) limiter.take(`team:${team.teamId}`, 10);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++)
      statuses.push((await consolePost(hub.url, team.sam.cookie, `/console/threads/${sent.thread}/reply`, { body: `r${i}` })).status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(10);
    const malik = await mcpClient(hub.url, team.malik.token);
    expect(code(await call(malik, "send_message", { to: "@lea", kind: "note", body: "still here", allow_offline: true }))).toBeNull();
    for (const c of [lea, malik]) await c.close();
    await hub.stop();
  });

  it("lets a team send as much as ten people at once, no more", async () => {
    const limiter = new RateLimiter(() => 0);
    const hub = await startHub({ limiter });
    const team = await hub.seed();
    const userId = newId("usr");
    await hub.db.insert(user).values({ id: userId, name: "Dev", email: "dev@acme.test", emailVerified: true });
    await hub.db.insert(membership).values({ id: newId("mem"), teamId: team.teamId, userId, role: "member", handle: "dev" });
    const { token } = await createPersonalToken(hub.db, { userId, teamId: team.teamId, label: "laptop" });
    const send = (from: string, to: string) =>
      hubRest(hub.url, from, "POST", "/v1/messages", { to, kind: "note", body: "busy day", allow_offline: true });
    // Each writes to the next one, so that no pair of agents reaches the loop guard.
    const ring = [team.lea, team.sam, team.malik];
    for (const [i, from] of ring.entries())
      for (let n = 0; n < 10; n++) expect((await send(from.token, `@${ring[(i + 1) % 3]?.handle}`)).status).toBe(200);
    // 69 more sends of the team elsewhere: the hundredth passes, the 101st waits, though Dev has sent nothing yet.
    for (let i = 0; i < 69; i++) limiter.take(`team:${team.teamId}`, 10);
    expect((await send(token, "@lea")).status).toBe(200);
    expect((await send(token, "@lea")).status).toBe(429);
    await hub.stop();
  });
});
