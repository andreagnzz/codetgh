import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

// A new thread with no project, addressed to a person or the team, reaches only the console: the sender is told.
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

const WARNING = "console only: no project on this thread; name a project or agent:<id> to reach a session";

it("warns a project-less sender that a new thread to a person or the team reaches the console only", async () => {
  // Malik has no session: his calls go through his auto agent, which has no project.
  const malik = await mcpClient(hub.url, team.malik.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  const send = async (args: Record<string, unknown>, c = malik) =>
    JSON.parse((await call(c, "send_message", { kind: "note", ...args })).text);
  const toLea = await send({ to: "@lea", body: "from nowhere" });
  expect(toLea.warning).toBe(WARNING);
  expect((await send({ to: "@team", body: "to all, from nowhere" })).warning).toBe(WARNING);
  expect((await send({ to: `agent:${leaOnP1}`, body: "to a session" })).warning).toBeUndefined();
  expect((await send({ to: "@lea", body: "from a project", agent: samOnP1 }, sam)).warning).toBeUndefined();
  expect((await send({ reply_to: toLea.id, body: "same thread" })).warning).toBeUndefined();
  const asked = JSON.parse((await call(malik, "ask_peer", { to: "@lea", question: "anyone?", wait_s: 0 })).text);
  expect(asked.status).toBe("pending");
  expect(asked.warning).toBe(WARNING);
  await malik.close();
  await sam.close();
  const rest = await fetch(`${hub.url}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.malik.token}`, "content-type": "application/json" },
    body: JSON.stringify({ to: "@lea", kind: "note", body: "from the CLI" }),
  });
  expect((await rest.json()).warning).toBe(WARNING);
});
