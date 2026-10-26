import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, membership, project, team as teamTable } from "../src/db/schema.js";
import { ACME_REPO, type Hub, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const ids: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  ids.sam = (await startSession(hub.url, team.sam.token, "sam-a", { repo: ACME_REPO })).agent_id ?? "";
  ids.lea = (await startSession(hub.url, team.lea.token, "lea-a", { repo: ACME_REPO })).agent_id ?? "";
});
afterAll(() => hub.stop());

const get = (token: string, path: string) => fetch(`${hub.url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
const mark = (session: string, set: Partial<typeof agent.$inferInsert>) =>
  hub.db.update(agent).set(set).where(eq(agent.sessionId, session));
const minAgo = (n: number) => new Date(Date.now() - n * 60_000);
type Activity = { state: string; since_s: number | null; last_tool?: string; last_tool_age_s?: number };

type Mine = {
  sessions: Array<{
    agent: string;
    project_id: string | null;
    project_untrusted: string;
    presence: string;
    activity: Activity;
    last_seen: string;
  }>;
  repo: { linked: boolean; project_id: string | null; project_untrusted: string; auto_link: boolean } | null;
  trust: string;
};
const mine = async (token: string, query = "") => {
  const res = await get(token, `/v1/me/sessions${query}`);
  return { status: res.status, body: (await res.json()) as Mine };
};
const projects = async () => (await hub.db.select().from(project)).length;
const agents = async () => (await hub.db.select().from(agent)).length;

it("lists only the caller's own sessions, with their project, presence and activity, and no repository without a fingerprint", async () => {
  await mark("sam-a", { activity: "idle", activityAt: minAgo(12), lastSeenAt: new Date() });
  const { status, body } = await mine(team.sam.token);
  expect(status).toBe(200);
  expect(body.sessions.map((s) => s.agent)).toContain(ids.sam);
  expect(body.sessions.map((s) => s.agent)).not.toContain(ids.lea);
  const s = body.sessions.find((x) => x.agent === ids.sam);
  expect(s).toMatchObject({ project_untrusted: "acme", presence: "online", activity: { state: "idle", since_s: expect.any(Number) } });
  expect(s?.project_id).toMatch(/^prj_/);
  expect(body.repo).toBeNull();
  expect(body.trust).toMatch(/^untrusted-peer/);
  expect((await fetch(`${hub.url}/v1/me/sessions`)).status).toBe(401);
});

it("says what a repository fingerprint would do, linked or not, without registering or linking anything", async () => {
  const [acme] = await hub.db.select().from(project).where(eq(project.repoFingerprint, ACME_REPO));
  const known = await mine(team.sam.token, `?repo_fingerprint=${ACME_REPO}`);
  expect(known.body.repo).toEqual({ linked: true, project_id: acme?.id, project_untrusted: "acme", auto_link: true });

  const projectsBefore = await projects();
  const agentsBefore = await agents();
  const fp = repoFingerprint("git@github.com:acme/never-seen.git");
  expect((await mine(team.sam.token, `?repo_fingerprint=${fp}`)).body.repo).toEqual({
    linked: false,
    project_id: null,
    project_untrusted: "",
    auto_link: true,
  });
  await hub.db.update(teamTable).set({ settings: { auto_link_projects: false } });
  expect((await mine(team.sam.token, `?repo_fingerprint=${fp}`)).body.repo?.auto_link).toBe(false);
  await hub.db.update(teamTable).set({ settings: {} });
  expect(await projects()).toBe(projectsBefore);
  expect(await agents()).toBe(agentsBefore);

  expect((await mine(team.sam.token, "?repo_fingerprint=nope")).status).toBe(400);
});

// team_overview refuses a guest (an external A2A agent is one): this route must not tell them more, such as whether a
// repository they can fingerprint is a team project, and its name.
it("refuses a guest, even with the fingerprint of a linked project, and names no project", async () => {
  await startSession(hub.url, team.malik.token, "malik-a", { repo: ACME_REPO });
  await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
  const linked = await get(team.malik.token, `/v1/me/sessions?repo_fingerprint=${ACME_REPO}`);
  const plain = await get(team.malik.token, "/v1/me/sessions");
  await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
  for (const res of [linked, plain]) expect(res.status).toBe(403);
  const body = await linked.text();
  expect(JSON.parse(body)).toEqual({ code: "E_FORBIDDEN", message: "guests see only their own threads" });
  expect(body).not.toContain("acme");
});
