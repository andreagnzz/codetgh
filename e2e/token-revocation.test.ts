import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { personalToken } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("closes an open token stream as soon as its token is revoked", async () => {
  const [token] = await hub.db.select().from(personalToken).where(eq(personalToken.userId, team.sam.userId));
  const stream = await fetch(`${hub.url}/v1/stream`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
  expect(stream.status).toBe(200);
  const reader = stream.body?.getReader();
  const closed = (async () => {
    while (reader && !(await reader.read()).done);
    return "closed";
  })();

  const res = await consolePost(hub.url, team.sam.cookie, `/console/tokens/${token?.id}/revoke`);
  expect(res.status).toBeLessThan(400);

  const outcome = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve("still open"), 3000))]);
  expect(outcome).toBe("closed");
  expect((await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${team.sam.token}` } })).status).toBe(401);
});
