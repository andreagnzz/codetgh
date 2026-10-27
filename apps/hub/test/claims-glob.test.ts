import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, claim } from "../src/db/schema.js";
import { globTooComplex } from "../src/domain/claims.js";
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

describe("claim globs are bounded: one member's scope cannot stall the hub", () => {
  it("refuses a glob with many brace groups at creation", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect(code(await call(lea, "claim", { scope: ["{*,*}".repeat(47) + "z"] }))).toBe("E_INVALID");
    await lea.close();
  });

  it.each(["src/**", "**/*.ts", "{a,b}/*.ts", "packages/*/src/**", "src/**/*.{ts,tsx}", "*.config.*"])("keeps %s", (scope) => {
    expect(globTooComplex(scope)).toBe(false);
  });

  it.each(["{*,*}".repeat(4), "*a*a*a*a", "{a,{b,c}}/x", "{a,b,c,d,e}/{f,g,h,i,j,k}/x"])("refuses %s", (scope) => {
    expect(globTooComplex(scope)).toBe(true);
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
      scope: "{*,*}".repeat(12) + "z",
      mode: "exclusive",
      ttlS: 14400,
      expiresAt: new Date(Date.now() + 14400_000),
    });
    const t0 = performance.now();
    const res = await preEdit(team.sam.token, "sam-glob", "src/api/users.ts");
    expect(performance.now() - t0).toBeLessThan(100);
    expect(res.status).toBe(204);
  });
});
