import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost, stream } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const P2 = repoFingerprint("git@github.com:acme/billing.git");
const ids: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "", push_rewake: "on" });
  // Léa has a session on each project and one outside any project; Sam works on P1.
  for (const [key, repo] of [
    ["lea-p1", P1],
    ["lea-p2", P2],
    ["lea-free", undefined],
  ] as const)
    ids[key] = (await startSession(hub.url, team.lea.token, key, { repo })).agent_id ?? "";
  ids["sam-p1"] = (await startSession(hub.url, team.sam.token, "sam-p1", { repo: P1 })).agent_id ?? "";
});
afterAll(() => hub.stop());

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const prompt = async (session: string, waitS = 0) => {
  const res = await fetch(`${hub.url}/v1/inbox/prompt?session_id=${session}${waitS ? `&wait_s=${waitS}` : ""}`, {
    headers: auth(team.lea.token),
  });
  return res.status === 200 ? ((await res.json()) as { context: string }).context : "";
};
const inbox = async (agent: string) => {
  const lea = await mcpClient(hub.url, team.lea.token);
  const text = (await call(lea, "inbox_read", { agent })).text;
  await lea.close();
  return text;
};
const samSends = async (to: string, body: string) => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const sent = JSON.parse((await call(sam, "send_message", { agent: ids["sam-p1"], to, kind: "note", body })).text);
  await sam.close();
  return sent as { id: string; thread: string };
};
describe("delivery follows the session's project", () => {
  it("brings a P1 thread message to the P1 session only: inbox, prompt, rewake and stream", async () => {
    const s1 = stream(hub.url, team.lea.token, "lea-p1");
    const s2 = stream(hub.url, team.lea.token, "lea-p2");
    await Promise.all([s1.ready(), s2.ready()]);
    const woke1 = prompt("lea-p1", 5);
    const woke2 = prompt("lea-p2", 2);
    const sent = await samSends("@lea", "P1 schema is frozen");

    expect(await woke1).toContain("P1 schema is frozen");
    expect(await woke2).toBe("");
    expect(await s1.waitFor(sent.id)).toContain(sent.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await s2.close()).not.toContain(sent.id);
    await s1.close();

    expect(await prompt("lea-p1")).toContain("P1 schema is frozen");
    expect(await prompt("lea-p2")).toBe("");
    expect(await prompt("lea-free")).toBe("");
    expect(await inbox(ids["lea-p1"] ?? "")).toContain("P1 schema is frozen");
    expect(await inbox(ids["lea-p2"] ?? "")).not.toContain("P1 schema is frozen");
  });

  it("always brings a message addressed to agent:<id> to that agent, even outside a project", async () => {
    await samSends(`agent:${ids["lea-free"]}`, "for your free session");
    expect(await prompt("lea-free")).toContain("for your free session");
    expect(await inbox(ids["lea-free"] ?? "")).toContain("for your free session");
    expect(await prompt("lea-p2")).not.toContain("for your free session");
  });

  it("shows a DM with no project in no session, but in the console and the person's CLI", async () => {
    const res = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: auth(team.sam.token),
      body: JSON.stringify({ to: "@lea", kind: "note", body: "lunch at noon?", allow_offline: true }),
    });
    const sent = (await res.json()) as { thread: string };
    for (const s of ["lea-p1", "lea-p2", "lea-free"]) expect(await prompt(s)).not.toContain("lunch at noon?");
    for (const s of ["lea-p1", "lea-p2", "lea-free"]) expect(await inbox(ids[s] ?? "")).not.toContain("lunch at noon?");

    const threads = await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.lea.cookie } })).text();
    expect(threads).toContain(sent.thread);
    const cli = (await (await fetch(`${hub.url}/v1/inbox`, { method: "POST", headers: auth(team.lea.token), body: "{}" })).json()) as {
      envelopes: string[];
    };
    expect(cli.envelopes.join("\n")).toContain("lunch at noon?");
  });
});
