import { repoFingerprint } from "@codetgh/shared/repo";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, message, project } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

// SPEC « Livraison »: a message to people or sessions reaches one of their live sessions, or fails with E_UNREACHABLE.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const P2 = repoFingerprint("git@github.com:acme/billing.git");
const ids: Record<string, string> = {};
let p1 = "";
let now = Date.now();
beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  for (const [key, token, repo] of [
    ["sam-p1", team.sam.token, P1],
    ["sam-free", team.sam.token, undefined],
    ["lea-p1", team.lea.token, P1],
    ["lea-old", team.lea.token, P1],
  ] as const)
    ids[key] = (await startSession(hub.url, token, key, { repo })).agent_id ?? "";
  p1 = (await hub.db.select().from(project).where(eq(project.repoFingerprint, P1)))[0]?.id ?? "";
});
afterAll(() => hub.stop());

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const tool = async (name: string, args: Record<string, unknown>, token = team.sam.token) => {
  const c = await mcpClient(hub.url, token);
  const r = await call(c, name, args);
  await c.close();
  return { isError: r.isError, out: r.json() };
};
const send = (args: Record<string, unknown>, token = team.sam.token) =>
  tool("send_message", { kind: "note", body: "hello", ...args }, token);
const stored = async () => (await hub.db.select({ n: count() }).from(message))[0]?.n ?? 0;

describe("a message that reaches nobody is an error", () => {
  it("refuses a message to a person with no session, and stores nothing", async () => {
    const before = await stored();
    const r = await send({ agent: ids["sam-p1"], to: "@malik" });
    expect(r.isError).toBe(true);
    expect(r.out.code).toBe("E_UNREACHABLE");
    expect(r.out.message).toContain("@malik has no session that would receive this: no session in the last 24 h");
    expect(r.out.message).toContain("allow_offline: true");
    expect(await stored()).toBe(before);
  });

  it("names the session a person has on another project", async () => {
    ids["malik-p2"] = (await startSession(hub.url, team.malik.token, "malik-p2", { repo: P2 })).agent_id ?? "";
    const free = await send({ agent: ids["sam-free"], to: "@malik" });
    expect(free.out.code).toBe("E_UNREACHABLE");
    expect(free.out.message).toContain(`1 session online: agent:${ids["malik-p2"]}`);
    expect(free.out.message).toContain("this thread has no project");
    // Hub ids only: no project name, which a member typed.
    expect(free.out.message).not.toContain("acme/");
    const fromP1 = await send({ agent: ids["sam-p1"], to: "@malik" });
    expect(fromP1.out.message).toContain(`agent:${ids["malik-p2"]}`);
    expect(fromP1.out.message).toContain(`this thread is on project ${p1}`);
    // That session, named, gets it.
    const direct = await send({ agent: ids["sam-free"], to: `agent:${ids["malik-p2"]}` });
    expect(direct.isError).toBe(false);
    expect(direct.out.reach).toEqual([
      { handle: "@malik", sessions: [{ agent: ids["malik-p2"], project: expect.stringMatching(/^prj_/), presence: "online" }] },
    ]);
  });

  it("lists the sessions a message reaches", async () => {
    const r = await send({ agent: ids["sam-p1"], to: "@lea" });
    expect(r.isError).toBe(false);
    expect(r.out.reach).toHaveLength(1);
    expect(r.out.reach[0].handle).toBe("@lea");
    expect(r.out.reach[0].sessions).toEqual(
      expect.arrayContaining([
        { agent: ids["lea-p1"], project: p1, presence: "online" },
        { agent: ids["lea-old"], project: p1, presence: "online" },
      ]),
    );
    expect(r.out.reach[0].sessions).toHaveLength(2);
  });

  it("refuses an ended session, and a reply to it, naming the person's live one", async () => {
    const q = await send({ agent: ids["lea-old"], to: "@sam", kind: "question", body: "which port?" }, team.lea.token);
    expect(q.out.reach).toEqual([{ handle: "@sam", sessions: [{ agent: ids["sam-p1"], project: p1, presence: "online" }] }]);
    await fetch(`${hub.url}/v1/agents/session/end`, {
      method: "POST",
      headers: auth(team.lea.token),
      body: JSON.stringify({ session_id: "lea-old" }),
    });
    const before = await stored();
    const toEnded = await send({ agent: ids["sam-p1"], to: `agent:${ids["lea-old"]}` });
    expect(toEnded.out.code).toBe("E_UNREACHABLE");
    expect(toEnded.out.message).toContain(`agent:${ids["lea-old"]} (@lea) has no session that would receive this: that session ended`);
    expect(toEnded.out.message).toContain(`1 session online: agent:${ids["lea-p1"]}`);
    const reply = await send({ agent: ids["sam-p1"], reply_to: q.out.id, kind: "answer", body: "5432" });
    expect(reply.out.code).toBe("E_UNREACHABLE");
    expect(reply.out.message).toContain(`agent:${ids["lea-p1"]}`);
    expect(await stored()).toBe(before);
  });

  it("says when a person's sessions are all offline, and since when", async () => {
    await hub.db
      .update(agent)
      .set({ lastSeenAt: new Date(Date.now() - 7 * 3600_000) })
      .where(eq(agent.id, ids["malik-p2"] ?? ""));
    const r = await send({ agent: ids["sam-p1"], to: "@malik" });
    expect(r.out.code).toBe("E_UNREACHABLE");
    expect(r.out.message).toContain("@malik has no session that would receive this: 1 offline (last seen 7 h ago)");
    const rest = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: auth(team.sam.token),
      body: JSON.stringify({ to: "@malik", kind: "note", body: "from the CLI" }),
    });
    expect(rest.status).toBe(409);
    expect((await rest.json()).code).toBe("E_UNREACHABLE");
    const asked = await tool("ask_peer", { agent: ids["sam-p1"], to: "@malik", question: "there?", wait_s: 0 });
    expect(asked.out.code).toBe("E_UNREACHABLE");
  });

  it("keeps a message for the console and the next session with allow_offline", async () => {
    const r = await send({ agent: ids["sam-p1"], to: "@malik", allow_offline: true });
    expect(r.isError).toBe(false);
    expect(r.out.reach).toEqual([]);
    const asked = await tool("ask_peer", { agent: ids["sam-p1"], to: "@malik", question: "there?", wait_s: 0, allow_offline: true });
    expect(asked.out).toMatchObject({ status: "pending", reach: [] });
    const rest = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: auth(team.sam.token),
      body: JSON.stringify({ to: "@malik", kind: "note", body: "from the CLI", allow_offline: true }),
    });
    expect(await rest.json()).toMatchObject({ reach: [] });
  });

  it("never refuses @team or thread:, and says whom they reach", async () => {
    const nobody = await send({ agent: ids["sam-free"], to: "@team" });
    expect(nobody.isError).toBe(false);
    expect(nobody.out.reach).toEqual([]);
    const inThread = await send({ agent: ids["sam-free"], to: `thread:${nobody.out.thread}` });
    expect(inThread.isError).toBe(false);
    const onP1 = await send({ agent: ids["sam-p1"], to: "@team" });
    expect(onP1.out.reach).toEqual([{ handle: "@lea", sessions: [{ agent: ids["lea-p1"], project: p1, presence: "online" }] }]);
  });
});
