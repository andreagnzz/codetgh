import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, membership, message, project } from "../apps/hub/src/db/schema.js";
import { expireStaleSessions, STALE_SESSION_MS } from "../apps/hub/src/domain/agents.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { callOnce, type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost, hubRest } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let lea: string;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");

// The session-start hook's registration: a launch (startup, resume) sets the list codetgh start passes on, or clears it.
const register = async (token: string, session: string, accept?: string[], source = "startup") => {
  const res = await hubRest(hub.url, token, "POST", "/v1/agents/session", {
    session_id: session,
    source,
    repo_fingerprint: P1,
    accept_requests_from: accept,
  });
  return ((await res.json()) as { agent_id: string }).agent_id;
};
const end = (token: string, session: string) => hubRest(hub.url, token, "POST", "/v1/agents/session/end", { session_id: session });
const request = async (token: string, from: string, body: string) => {
  const r = await callOnce(hub.url, token, "ask_peer", { agent: from, to: "@sam", kind: "request", question: body });
  expect(r.isError).toBe(false);
  return r.json().question_id as string;
};
// What Sam's session is shown: its prompt hook (and rewake waiter), then inbox_read.
const prompt = async (session: string) => {
  const res = await fetch(`${hub.url}/v1/inbox/prompt?session_id=${session}`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
  return res.status === 200 ? ((await res.json()) as { context: string }).context : "";
};
const shown = async (session: string, agentId: string) =>
  `${await prompt(session)}\n${(await callOnce(hub.url, team.sam.token, "inbox_read", { agent: agentId })).text}`;
const refused = async () =>
  (await callOnce(hub.url, team.lea.token, "ask_peer", { agent: lea, to: "@sam", kind: "request", question: "after" })).text;
const expired = async (id: string) =>
  ((await hub.db.select().from(message).where(eq(message.id, id)))[0]?.expiresAt?.getTime() ?? Infinity) <= Date.now();

beforeAll(async () => {
  // An hour passes between calls: this file sends many registrations and requests as one person, and tests no budget.
  let now = Date.now();
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  lea = await register(team.lea.token, "lea-main");
});
afterAll(() => hub.stop());

describe("a delegated request is authorized only while the receiver's opt-in holds", () => {
  it("is shown as authorized while the delegate accepts its sender, and expires once it resumes without the option", async () => {
    const sam = await register(team.sam.token, "sam-resume", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the resume");
    expect(await shown("sam-resume", sam)).toContain('authorized="true"');
    await register(team.sam.token, "sam-resume", undefined, "resume");
    const after = await shown("sam-resume", sam);
    expect(after).not.toContain('authorized="true"');
    expect(after).not.toContain("Do it now");
    expect(await expired(id)).toBe(true);
  });

  it("expires once the delegate is launched again with a list that no longer has its sender", async () => {
    const sam = await register(team.sam.token, "sam-relaunch", ["@lea", "@malik"]);
    const id = await request(team.lea.token, lea, "task before the relaunch");
    await register(team.sam.token, "sam-relaunch", ["@malik"]);
    const after = await shown("sam-relaunch", sam);
    expect(after).not.toContain('authorized="true"');
    expect(after).not.toContain("Do it now");
    expect(await expired(id)).toBe(true);
    await end(team.sam.token, "sam-relaunch");
  });

  it("expires when the delegate session ends", async () => {
    await register(team.sam.token, "sam-end", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the end");
    await end(team.sam.token, "sam-end");
    expect(await expired(id)).toBe(true);
  });

  it("expires when the hub ends a delegate session it stopped seeing", async () => {
    const sam = await register(team.sam.token, "sam-silent", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the silence");
    await hub.db
      .update(agent)
      .set({ lastSeenAt: new Date(Date.now() - STALE_SESSION_MS - 60_000) })
      .where(eq(agent.id, sam));
    await expireStaleSessions(hub.db);
    expect(await expired(id)).toBe(true);
  });

  it("expires when the delegate session is removed in the console", async () => {
    const sam = await register(team.sam.token, "sam-removed", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the removal");
    expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${sam}/remove`)).status).toBe(204);
    expect(await expired(id)).toBe(true);
  });

  it("expires when the delegate session is attached to another project in the console", async () => {
    const sam = await register(team.sam.token, "sam-moved", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the move");
    const [billing] = await hub.db.select().from(project).where(eq(project.name, "acme/billing"));
    expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${sam}/project`, { project_id: billing?.id ?? "" })).status).toBe(
      204,
    );
    expect(await expired(id)).toBe(true);
    await end(team.sam.token, "sam-moved");
  });
});

describe("a request sent under an earlier opt-in is never authorized by a later one", () => {
  // What an expiry missed by a race would leave: the old request still pending.
  const missed = (id: string) =>
    hub.db
      .update(message)
      .set({ expiresAt: new Date(Date.now() + 600_000) })
      .where(eq(message.id, id));
  const authorized = (page: string, id: string) => new RegExp(`<peer_message id="${id}"[^>]*authorized="true"`).test(page);
  // Malik sends: the loop guard caps the requests between two people, and Léa sends most of this file's.
  const rearmed = async (session: string, between: () => Promise<unknown>) => {
    const malik = await register(team.malik.token, "malik-rearm");
    const sam = await register(team.sam.token, session, ["@malik"]);
    const old = await request(team.malik.token, malik, `task under the first opt-in of ${session}`);
    await between();
    await missed(old);
    await register(team.sam.token, session, ["@malik"], "resume");
    await missed(old);
    const fresh = await request(team.malik.token, malik, `task under the second opt-in of ${session}`);
    const page = await shown(session, sam);
    await end(team.sam.token, session);
    return { old: authorized(page, old), fresh: authorized(page, fresh), shownOld: page.includes(old) };
  };

  it("after a registration without the option", async () => {
    const r = await rearmed("sam-rearm", () => register(team.sam.token, "sam-rearm", undefined, "resume"));
    expect(r).toMatchObject({ shownOld: true, old: false, fresh: true });
  });

  it("after the session ends and resumes", async () => {
    const r = await rearmed("sam-rearm-end", () => end(team.sam.token, "sam-rearm-end"));
    expect(r).toMatchObject({ shownOld: true, old: false, fresh: true });
  });
});

describe("the prompt hook tells a delegate to act only on what it shows", () => {
  it("adds no « Do it now » when the authorized request did not fit on the page", async () => {
    const sam = await register(team.sam.token, "sam-footer", ["@lea"]);
    const malik = await register(team.malik.token, "malik-footer");
    // Malik is not on the list: his high-priority message comes first and fills the page, Léa's request is left out.
    const big = await callOnce(hub.url, team.malik.token, "send_message", {
      agent: malik,
      to: `agent:${sam}`,
      kind: "note",
      priority: "high",
      body: "&".repeat(1800),
    });
    expect(big.isError).toBe(false);
    const id = await request(team.lea.token, lea, "task that does not fit");
    const page = await prompt("sam-footer");
    expect(page).toContain(big.json().id);
    expect(page).not.toContain(id);
    expect(page).not.toContain("Do it now");
    await end(team.sam.token, "sam-footer");
  });
});

describe("a delegate session ends with its owner's standing", () => {
  const accepts = async (session: string) =>
    (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0]?.acceptRequestsFrom ?? null;

  it("stops accepting requests when its owner is quarantined", async () => {
    const sam = await register(team.sam.token, "sam-quarantine", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the quarantine");
    expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${sam}/quarantined`)).status).toBe(204);
    expect(await accepts("sam-quarantine")).toBeNull();
    expect(await expired(id)).toBe(true);
    expect(await shown("sam-quarantine", sam)).not.toContain('authorized="true"');
    expect(await refused()).toContain("E_NO_DELEGATE");
    expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${sam}/trusted`)).status).toBe(204);
    await end(team.sam.token, "sam-quarantine");
  });

  it("stops accepting requests when its owner becomes a guest", async () => {
    await register(team.sam.token, "sam-guest", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the demotion");
    const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
    const role = (r: string) => consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/role`, { role: r });
    expect((await role("guest")).status).toBe(204);
    expect(await accepts("sam-guest")).toBeNull();
    expect(await expired(id)).toBe(true);
    expect(await refused()).toContain("E_NO_DELEGATE");
    expect((await role("member")).status).toBe(204);
    await end(team.sam.token, "sam-guest");
  });
});

describe("an opt-in left on a receiver who lost their standing does nothing", () => {
  // What a role or trust change racing a registration could leave: the opt-in still on the row.
  const lose = {
    guest: (lost: boolean) =>
      hub.db
        .update(membership)
        .set({ role: lost ? "guest" : "member" })
        .where(eq(membership.userId, team.sam.userId)),
    quarantined: (lost: boolean) =>
      hub.db
        .update(agent)
        .set({ trustLevel: lost ? "quarantined" : "trusted" })
        .where(eq(agent.userId, team.sam.userId)),
  };
  for (const [state, set] of Object.entries(lose))
    it(`shows no authorized request and routes none to a receiver now ${state}`, async () => {
      const sam = await register(team.sam.token, `sam-stale-${state}`, ["@lea"]);
      await request(team.lea.token, lea, `task for a receiver now ${state}`);
      await set(true);
      const page = await shown(`sam-stale-${state}`, sam);
      const again = await refused();
      await set(false);
      expect(page).toContain(`task for a receiver now ${state}`);
      expect(page).not.toContain('authorized="true"');
      expect(page).not.toContain("Do it now");
      expect(again).toContain("E_NO_DELEGATE");
      await end(team.sam.token, `sam-stale-${state}`);
    });
});

// Last: Malik leaves the team.
describe("a delegated request is authorized only while its sender is a member", () => {
  it("is an ordinary request once its sender is revoked", async () => {
    const sam = await register(team.sam.token, "sam-revoked", ["@malik"]);
    const malik = await register(team.malik.token, "malik-main");
    await request(team.malik.token, malik, "task from a member about to leave");
    const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.malik.userId));
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/revoke`)).status).toBe(204);
    const after = await shown("sam-revoked", sam);
    expect(after).toContain("task from a member about to leave");
    expect(after).not.toContain('authorized="true"');
    expect(after).not.toContain("Do it now");
  });
});

// Last of all: Sam leaves the team.
describe("a delegated request expires with its receiver's membership", () => {
  it("expires when the receiver is revoked", async () => {
    await register(team.sam.token, "sam-leaving", ["@lea"]);
    const id = await request(team.lea.token, lea, "task before the receiver leaves");
    const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/revoke`)).status).toBe(204);
    expect(await expired(id)).toBe(true);
  });
});
