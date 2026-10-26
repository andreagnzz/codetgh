import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost, hubRest } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const send = (token: string, kind: string) =>
  hubRest(hub.url, token, "POST", "/v1/messages", { to: "@lea", kind, body: `a ${kind}`, priority: "normal", allow_offline: true });

it("keeps a member quarantined whatever new session or agent their token opens", async () => {
  const first = (await startSession(hub.url, team.sam.token, "sam-q1", { repo: ACME_REPO })).agent_id;
  expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${first}/quarantined`)).status).toBe(204);

  // A fresh session, a REST send with no agent, an MCP call: all still quarantined.
  const second = await startSession(hub.url, team.sam.token, "sam-q2", { repo: ACME_REPO });
  expect(second.agent_id).not.toBe(first);
  expect((await send(team.sam.token, "request")).status).toBe(403);
  const sam = await mcpClient(hub.url, team.sam.token);
  expect((await call(sam, "send_message", { to: "@lea", kind: "request", body: "do it" })).isError).toBe(true);
  expect((await call(sam, "status_set", { text: "free" })).isError).toBe(true);

  // Removing the quarantined agent does not lift it, and only an admin can.
  await consolePost(hub.url, team.sam.cookie, `/console/agents/${first}/remove`);
  expect((await send(team.sam.token, "request")).status).toBe(403);
  expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${second.agent_id}/trusted`)).status).toBe(403);

  expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${second.agent_id}/trusted`)).status).toBe(204);
  expect((await send(team.sam.token, "request")).status).toBe(200);
});
