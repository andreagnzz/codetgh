import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { membership, message } from "../apps/hub/src/db/schema.js";
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
