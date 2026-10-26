import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { message } from "../apps/hub/src/db/schema.js";
import { resolveAgent } from "../apps/hub/src/domain/agents.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { sendMessage } from "../apps/hub/src/domain/messages.js";
import { principalForToken } from "../apps/hub/src/principal.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("answers a send retried while the first is still in flight with the same message", async () => {
  const p = await principalForToken(hub.db, team.sam.token);
  if (!p) throw new Error("no principal");
  const author = { p, agent: await resolveAgent(hub.db, p, undefined, "rest"), via: "rest" as const };
  const deps = { db: hub.db, bus: hub.bus, limiter: new RateLimiter(), secret: hub.config.secret };
  const input = {
    to: "@lea",
    kind: "note" as const,
    body: "outbox replay",
    priority: "normal" as const,
    refs: [],
    allow_offline: true,
    idempotency_key: "replay-1",
  };
  // Both retries read "no such message yet" before either one writes.
  const [first, second] = await Promise.all([sendMessage(deps, author, input), sendMessage(deps, author, input)]);
  expect(second.id).toBe(first.id);
  expect(await hub.db.select().from(message).where(eq(message.body, "outbox replay"))).toHaveLength(1);
});
