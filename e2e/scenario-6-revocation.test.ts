import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { auditEvent, claim, membership, personalToken } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("cuts a revoked member everywhere within 5 seconds (scenario 6)", async () => {
  await startSession(hub.url, team.malik.token, "malik-s6", { repo: ACME_REPO });
  const malik = await mcpClient(hub.url, team.malik.token);
  expect((await call(malik, "whoami")).isError).toBe(false);
  expect((await call(malik, "claim", { scope: ["api/orders.ts"] })).isError).toBe(false);
  const stream = await fetch(`${hub.url}/console/stream`, { headers: { cookie: team.malik.cookie } });
  expect(stream.status).toBe(200);
  const reader = stream.body?.getReader();
  const closed = (async () => {
    while (reader && !(await reader.read()).done);
  })();
  const tokenStream = await fetch(`${hub.url}/v1/stream`, { headers: { Authorization: `Bearer ${team.malik.token}` } });
  expect(tokenStream.status).toBe(200);
  const tokenReader = tokenStream.body?.getReader();
  const tokenClosed = (async () => {
    while (tokenReader && !(await tokenReader.read()).done);
  })();

  const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.malik.userId));
  const started = Date.now();
  const res = await consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/revoke`);
  expect(res.status).toBeLessThan(400);

  await closed;
  await tokenClosed;
  await expect(call(malik, "whoami")).rejects.toThrow();
  expect((await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${team.malik.token}` } })).status).toBe(401);
  const consolePage = await fetch(`${hub.url}/console`, { headers: { cookie: team.malik.cookie }, redirect: "manual" });
  expect(consolePage.status).toBe(302);
  expect(consolePage.headers.get("location")).toBe("/login");
  expect(Date.now() - started).toBeLessThan(5000);

  const sam = await mcpClient(hub.url, team.sam.token);
  const overview = (await call(sam, "team_overview")).json();
  expect(overview.people.filter((p: { handle: string }) => p.handle === "malik")).toEqual([]);
  const tokens = await hub.db.select().from(personalToken).where(eq(personalToken.userId, team.malik.userId));
  expect(tokens.every((t) => t.revokedAt)).toBe(true);
  const claims = await hub.db.select().from(claim).where(eq(claim.holderUserId, team.malik.userId));
  expect(claims.map((c) => c.releaseReason)).toEqual(["revoked"]);
  const audited = await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "member.revoked"));
  expect(audited[0]).toMatchObject({ actorUserId: team.lea.userId, via: "console", subjectId: m?.id });
  await sam.close();
});
