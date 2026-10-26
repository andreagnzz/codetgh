import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bridgeLink, message, slackLink } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

const SIGNING = "test-slack-signing-secret";
const lines: string[] = [];
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub({
    logLines: lines,
    config: { slackSigningSecret: SIGNING },
  });
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("never writes a Slack reply's text to the logs when the database refuses it", async () => {
  const sent = await fetch(`${hub.url}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
    body: JSON.stringify({ to: "@lea", kind: "question", body: "Ready?", allow_offline: true }),
  });
  const [question] = await hub.db.select().from(message).where(eq(message.body, "Ready?"));
  expect(sent.status).toBe(200);
  await hub.db.insert(bridgeLink).values({ slackChannel: "C123", slackTs: "1.1", teamId: team.teamId, messageId: question?.id });
  await hub.db.insert(slackLink).values({ teamId: team.teamId, userId: team.lea.userId, slackUserId: "U_LEA" });

  // Postgres refuses NUL in text: the driver's error carries the query parameters, the reply included.
  const body = JSON.stringify({
    type: "event_callback",
    event: { type: "message", channel: "C123", user: "U_LEA", text: "salary talk\u0000 stays private", thread_ts: "1.1" },
  });
  const ts = Math.floor(Date.now() / 1000);
  const res = await fetch(`${hub.url}/bridges/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": `v0=${createHmac("sha256", SIGNING).update(`v0:${ts}:${body}`).digest("hex")}`,
    },
    body,
  });
  expect(res.status).toBe(200);
  for (let i = 0; i < 100 && !lines.some((l) => l.includes("slack event not relayed")); i++) await new Promise((r) => setTimeout(r, 50));

  expect(lines.some((l) => l.includes("slack event not relayed"))).toBe(true);
  expect(lines.join("")).not.toContain("salary talk");
});
