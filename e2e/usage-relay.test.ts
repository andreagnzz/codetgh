import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, thread } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { fakeGithubToken } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const rest = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${hub.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// The presence mod at 100 % of a plan limit: the session's agent from whoami, its status, then a note in a thread of its project.
it("sets a session's status over REST and sends a team note in a thread of the session's project", async () => {
  await startSession(hub.url, team.sam.token, "sam-limit", { repo: ACME_REPO });
  const me = (await (await rest(team.sam.token, "GET", "/v1/whoami?session_id=sam-limit")).json()) as { agent: { id: string } };

  const set = await rest(team.sam.token, "POST", "/v1/status", { agent: me.agent.id, text: "Hit the Claude usage limit", ttl_s: 3600 });
  expect(set.status).toBe(204);
  const [row] = await hub.db.select().from(agent).where(eq(agent.id, me.agent.id));
  expect(row?.statusText).toBe("Hit the Claude usage limit");
  expect(row?.statusExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 3500_000);

  const sent = await rest(team.sam.token, "POST", "/v1/messages", { agent: me.agent.id, to: "@team", kind: "note", body: "@sam is back." });
  expect(sent.status).toBe(200);
  const [t] = await hub.db
    .select()
    .from(thread)
    .where(eq(thread.id, ((await sent.json()) as { thread: string }).thread));
  expect(t?.projectId).toBe(row?.projectId);
  expect(t?.projectId).toBeTruthy();
});

it("refuses a status for someone else's agent and a status carrying a secret", async () => {
  const lea = (await startSession(hub.url, team.lea.token, "lea-limit", { repo: ACME_REPO })).agent_id;
  expect((await rest(team.sam.token, "POST", "/v1/status", { agent: lea, text: "mine now" })).status).toBe(403);
  const secret = await rest(team.sam.token, "POST", "/v1/status", { text: `key ${fakeGithubToken()}` });
  expect(secret.status).toBe(422);
});
