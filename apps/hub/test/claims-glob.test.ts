import { ClaimInput } from "@codetgh/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, claim } from "../src/db/schema.js";
import { covers, globTooComplex } from "../src/domain/claims.js";
import { newId } from "../src/ids.js";
import { ACME_REPO, call, code, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let leaAgent = "";
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  leaAgent = (await startSession(hub.url, team.lea.token, "lea-glob", { repo: ACME_REPO })).agent_id ?? "";
  await startSession(hub.url, team.sam.token, "sam-glob", { repo: ACME_REPO });
});
afterAll(() => hub.stop());

const preEdit = (token: string, sessionId: string, path: string) =>
  fetch(`${hub.url}/v1/claims/pre-edit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, path }),
  });

// What the hub spends in one covers() on a hostile path: median of 3 runs, so a GC pause does not count.
function costMs(scope: string, path: string) {
  const times = [0, 0, 0].map(() => {
    const t0 = performance.now();
    covers({ scopeType: "glob", scope }, path);
    return performance.now() - t0;
  });
  return times.sort((a, b) => a - b)[1] ?? 0;
}

describe("claim globs are bounded: one member's scope cannot stall the hub", () => {
  it("refuses a glob with many brace groups at creation", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect(code(await call(lea, "claim", { scope: ["{*,*}".repeat(47) + "z"] }))).toBe("E_INVALID");
    await lea.close();
  });

  it.each(["src/**", "**/*.ts", "{a,b}/*.ts", "packages/*/src/**", "src/**/*.{ts,tsx}", "*.config.*"])("keeps %s", (scope) => {
    expect(globTooComplex(scope)).toBe(false);
  });

  it.each(["{*,*}".repeat(4), "*a*a*az", "*{a,aa,aaa}*{a,aa,aaa}*z", "{a,{b,c}}/x", "{a,b,c,d,e}/{f,g,h,i,j,k}/x", "@(a|a)"])(
    "refuses %s",
    (scope) => {
      expect(globTooComplex(scope)).toBe(true);
    },
  );

  // picomatch reads a leading ! as "every path but": !x/** would hold the whole project past the coversProject guard.
  it.each(["!x/**", "!*", "./!src/**", "!!x/**"])("refuses the negated scope %s, and a stored one matches nothing", async (scope) => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect(code(await call(lea, "claim", { scope: [scope], mode: "exclusive" }))).toBe("E_INVALID");
    await lea.close();
    expect(covers({ scopeType: "glob", scope }, "lib/a.ts")).toBe(false);
  });

  it("still claims and matches ordinary globs", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect((await call(lea, "claim", { scope: ["{a,b}/*.ts", "packages/*/src/**"] })).isError).toBe(false);
    expect((await preEdit(team.sam.token, "sam-glob", "packages/web/src/x.ts")).status).toBe(200);
    expect((await preEdit(team.sam.token, "sam-glob", "b/x.ts")).status).toBe(200);
    expect((await preEdit(team.sam.token, "sam-glob", "c/x.ts")).status).toBe(204);
    await lea.close();
  });

  it("does not match a hostile scope already stored, so the edit hook stays fast", async () => {
    const [lea] = await hub.db.select().from(agent).where(eq(agent.id, leaAgent));
    await hub.db.insert(claim).values({
      id: newId("clm"),
      teamId: team.teamId,
      projectId: lea?.projectId ?? null,
      holderUserId: team.lea.userId,
      holderAgentId: leaAgent,
      scopeType: "glob",
      scope: "{*,*}".repeat(14) + "z",
      mode: "exclusive",
      ttlS: 14400,
      expiresAt: new Date(Date.now() + 14400_000),
    });
    const t0 = performance.now();
    const res = await preEdit(team.sam.token, "sam-glob", "src/api/users.ts");
    // The whole request, on a machine that may be loaded: unmatched it takes well under 500 ms, matched (14 groups) seconds.
    expect(performance.now() - t0).toBeLessThan(500);
    expect(res.status).toBe(204);
  });

  // The design target is 25 ms; 100 leaves room for a loaded CI machine. The old limits (3 wildcards) let
  // *{a,aa,aaa}*{a,aa,aaa}*z through at 340 ms.
  it("keeps every accepted scope under 100 ms on a long path", () => {
    const paths = ["a".repeat(300), `${"a".repeat(29)}/`.repeat(9) + "z"];
    const tokens = ["*", "**", "?", "a", ".", "/", "[ab]", "{a,aa}", "{a,aa,aaa}"];
    let seed = 20261027;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const hand = ["*a*a*az", "*{a,aa,aaa}*{a,aa,aaa}*z", "[ab]*[ab]*[ab]*z", "a?*a?*a?*z", "{a,b}*{a,b}*{a,b}*z", "**/a*/**/a*/**/z"];
    const random = Array.from({ length: 2500 }, () =>
      Array.from({ length: 3 + Math.floor(next() * 10) }, () => tokens[Math.floor(next() * tokens.length)]).join(""),
    );
    const accepted = [...hand, ...random].filter((s) => ClaimInput.safeParse({ scope: [s] }).success && !globTooComplex(s));
    expect(accepted.length).toBeGreaterThan(1000);
    // Stops at the first slow scope: a hostile one would otherwise run for minutes.
    const slow = accepted.find((s) => paths.some((p) => costMs(s, p) > 100));
    expect(slow).toBeUndefined();
  });
});
