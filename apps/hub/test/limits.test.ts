import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/domain/limits.js";

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
