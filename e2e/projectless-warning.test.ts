import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

// A new thread with no project reaches no session of a person: a message to them fails unless allow_offline.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let samOnP1 = "";
let leaOnP1 = "";
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  samOnP1 = (await startSession(hub.url, team.sam.token, "sam-p1", { repo: P1 })).agent_id ?? "";
  leaOnP1 = (await startSession(hub.url, team.lea.token, "lea-p1", { repo: P1 })).agent_id ?? "";
});
afterAll(() => hub.stop());

it("refuses a project-less message to a person unless allow_offline, and never one to the team", async () => {
  // Malik has no session: his calls go through his auto agent, which has no project.
  const malik = await mcpClient(hub.url, team.malik.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  const send = async (args: Record<string, unknown>, c = malik) =>
    JSON.parse((await call(c, "send_message", { kind: "note", ...args })).text);
  const refused = await send({ to: "@lea", body: "from nowhere" });
  expect(refused.code).toBe("E_UNREACHABLE");
  expect(refused.message).toContain("this thread has no project");
  const toLea = await send({ to: "@lea", body: "from nowhere", allow_offline: true });
  expect(toLea.reach).toEqual([]);
  expect((await send({ to: "@team", body: "to all, from nowhere" })).reach).toEqual([]);
  expect((await send({ to: `agent:${leaOnP1}`, body: "to a session" })).reach).toHaveLength(1);
  expect((await send({ to: "@lea", body: "from a project", agent: samOnP1 }, sam)).reach).toHaveLength(1);
  // A reply goes to the agent that sent the parent: Malik's auto agent reads what is addressed to it.
  const reply = await send({ reply_to: toLea.id, body: "same thread", agent: leaOnP1 }, lea);
  expect(reply.reach).toEqual([{ handle: "@malik", sessions: [{ agent: expect.any(String), project: null, presence: "online" }] }]);
  expect(JSON.parse((await call(malik, "ask_peer", { to: "@lea", question: "anyone?", wait_s: 0 })).text).code).toBe("E_UNREACHABLE");
  const asked = JSON.parse((await call(malik, "ask_peer", { to: "@lea", question: "anyone?", wait_s: 0, allow_offline: true })).text);
  expect(asked).toMatchObject({ status: "pending", reach: [] });
  await malik.close();
  await sam.close();
  await lea.close();
  const rest = await fetch(`${hub.url}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.malik.token}`, "content-type": "application/json" },
    body: JSON.stringify({ to: "@lea", kind: "note", body: "from the CLI" }),
  });
  expect(rest.status).toBe(409);
  expect((await rest.json()).code).toBe("E_UNREACHABLE");
});
