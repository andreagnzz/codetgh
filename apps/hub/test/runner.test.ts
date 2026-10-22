import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, membership, project, task } from "../src/db/schema.js";
import { RateLimiter } from "../src/domain/limits.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let projectId: string;
let otherProjectId: string;
let agentId: string;
let samAgentId: string;
beforeAll(async () => {
  let now = 0;
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  const [acme] = await hub.db
    .select()
    .from(project)
    .where(and(eq(project.teamId, team.teamId), eq(project.repoFingerprint, ACME_REPO)));
  const [other] = await hub.db
    .select()
    .from(project)
    .where(and(eq(project.teamId, team.teamId), eq(project.name, "acme/billing")));
  projectId = acme?.id ?? "";
  otherProjectId = other?.id ?? "";
  agentId = (await startSession(hub.url, team.lea.token, "runner-lea", { repo: ACME_REPO })).agent_id ?? "";
  samAgentId = (await startSession(hub.url, team.sam.token, "runner-sam", { repo: ACME_REPO })).agent_id ?? "";
});
afterAll(() => hub.stop());

const rest = (token: string, method: "GET" | "POST", path: string, body?: unknown) =>
  fetch(`${hub.url}/v1/runner/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const owner = (method: "GET" | "POST", path: string, body?: unknown) => rest(team.lea.token, method, path, body);

async function csrf(cookie: string) {
  const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
  return html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;/)?.[1] ?? "";
}
const switchRunner = async (id: string, on: boolean) =>
  fetch(`${hub.url}/console/projects/${id}/runner`, {
    method: "POST",
    headers: {
      cookie: team.lea.cookie,
      "content-type": "application/x-www-form-urlencoded",
      "X-CSRF-Token": await csrf(team.lea.cookie),
    },
    body: new URLSearchParams({ on: on ? "1" : "0" }).toString(),
  });

// Created by Léa's agent (the owner) in the acme project, as /codetgh:split --run would.
async function create(args: Record<string, unknown>) {
  const lea = await mcpClient(hub.url, team.lea.token);
  const r = await call(lea, "task_create", { agent: agentId, title: "t", runner: true, ...args });
  await lea.close();
  if (r.isError) throw new Error(r.text);
  return JSON.parse(r.text) as { id: string; version: number; runner: boolean };
}
const ready = async (id = projectId) =>
  ((await (await owner("GET", `ready?project=${id}`)).json()) as { tasks: Array<{ id: string }> }).tasks;
const readyIds = async () => (await ready()).map((t) => t.id);
const set = (id: string, values: Partial<typeof task.$inferInsert>) => hub.db.update(task).set(values).where(eq(task.id, id));
const row = async (id: string) => (await hub.db.select().from(task).where(eq(task.id, id)))[0];

describe("runner queue", () => {
  it("is off until the owner switches the project on in the console", async () => {
    const t = await create({ title: "off" });
    expect(await readyIds()).not.toContain(t.id);
    expect((await switchRunner(projectId, true)).status).toBe(204);
    expect(await readyIds()).toContain(t.id);
    const targets = await (await owner("GET", "targets")).json();
    expect(targets.targets).toContainEqual({ project_id: projectId, project_name: "acme", desired: true });
    await set(t.id, { status: "cancelled" });
  });

  it("lists ready tasks only: deps done or stacked on an open PR, runner on, this project", async () => {
    const done = await create({ title: "done dep" });
    const stacked = await create({ title: "review dep with PR" });
    const noPr = await create({ title: "review dep without PR" });
    await set(done.id, { status: "done" });
    await set(stacked.id, { status: "review", prNumber: 12, branch: "codetgh/a" });
    await set(noPr.id, { status: "review" });
    const onDone = await create({ title: "on done", depends_on: [done.id] });
    const onStack = await create({ title: "on stack", depends_on: [stacked.id] });
    const onNoPr = await create({ title: "on no PR", depends_on: [noPr.id] });
    const manual = await create({ title: "manual", runner: false });
    const ids = await readyIds();
    expect(ids).toEqual(expect.arrayContaining([onDone.id, onStack.id]));
    expect(ids).not.toContain(onNoPr.id);
    expect(ids).not.toContain(manual.id);
    expect(ids).not.toContain(done.id);

    const elsewhere = await create({ title: "elsewhere" });
    await set(elsewhere.id, { projectId: otherProjectId });
    expect(await readyIds()).not.toContain(elsewhere.id);
    await switchRunner(otherProjectId, true);
    expect((await ready(otherProjectId)).map((t) => t.id)).toEqual([elsewhere.id]);

    const lease = await (await owner("POST", "lease", { task_id: onStack.id, owner: "vps-1" })).json();
    expect(lease.parents).toEqual([{ task_id: stacked.id, branch: "codetgh/a", pr_number: 12 }]);
    expect(lease.text).toContain('trust="untrusted-peer"');
    for (const t of [onDone, onStack, onNoPr, manual, elsewhere]) await set(t.id, { status: "cancelled", leaseOwner: null });
  });

  it("leases a task to exactly one of two concurrent runners", async () => {
    const t = await create({ title: "race" });
    const [a, b] = await Promise.all([
      owner("POST", "lease", { task_id: t.id, owner: "vps-1" }),
      owner("POST", "lease", { task_id: t.id, owner: "laptop" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const r = await row(t.id);
    expect(r).toMatchObject({ status: "claimed", attempts: 1, assigneeUserId: team.lea.userId });
    expect(["vps-1", "laptop"]).toContain(r?.leaseOwner);
    expect(r?.leaseUntil && r.leaseUntil.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(await readyIds()).not.toContain(t.id);
    await set(t.id, { status: "cancelled", leaseOwner: null });
  });

  it("puts a task whose lease expired back in the queue", async () => {
    const t = await create({ title: "expiry" });
    expect((await owner("POST", "lease", { task_id: t.id, owner: "vps-1" })).status).toBe(200);
    await set(t.id, { leaseUntil: new Date(Date.now() - 1000) });
    expect(await readyIds()).toContain(t.id);
    expect(await row(t.id)).toMatchObject({ status: "todo", leaseOwner: null, leaseUntil: null, assigneeUserId: null });
    expect((await owner("POST", "lease", { task_id: t.id, owner: "laptop" })).status).toBe(200);
    expect((await row(t.id))?.attempts).toBe(2);
    await set(t.id, { status: "cancelled", leaseOwner: null });
  });

  it("renews a lease for its holder only", async () => {
    const t = await create({ title: "renew" });
    await owner("POST", "lease", { task_id: t.id, owner: "vps-1" });
    expect((await owner("POST", "renew", { task_id: t.id, owner: "laptop" })).status).toBe(409);
    const res = await owner("POST", "renew", { task_id: t.id, owner: "vps-1" });
    expect(res.status).toBe(200);
    expect(new Date((await res.json()).lease_until).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    await set(t.id, { status: "cancelled", leaseOwner: null });
  });

  it("moves a leased task through the allowed statuses, then drops the lease in review", async () => {
    const t = await create({ title: "update" });
    await owner("POST", "lease", { task_id: t.id, owner: "vps-1" });
    const update = (o: string, patch: Record<string, unknown>) => owner("POST", "update", { task_id: t.id, owner: o, patch });
    expect((await update("laptop", { status: "in_progress" })).status).toBe(409);
    expect((await update("vps-1", { status: "review" })).status).toBe(400);
    expect((await update("vps-1", { branch: "-delete" })).status).toBe(400);
    const started = await update("vps-1", { status: "in_progress", branch: "codetgh/update", base_branch: "main" });
    expect(started.status).toBe(200);
    expect((await started.json()).status).toBe("in_progress");
    expect((await update("vps-1", { status: "review", pr_number: 41, note: "PR #41 opened" })).status).toBe(200);
    expect(await row(t.id)).toMatchObject({
      status: "review",
      branch: "codetgh/update",
      baseBranch: "main",
      prNumber: 41,
      leaseOwner: null,
      leaseUntil: null,
    });
    expect((await row(t.id))?.notes.at(-1)?.text).toBe("PR #41 opened");
    expect((await update("vps-1", { review_round: 1 })).status).toBe(409);

    const actions = (await hub.db.select().from(auditEvent).where(eq(auditEvent.subjectId, t.id))).map((e) => e.action);
    expect(actions).toEqual(["task.created", "runner.leased", "runner.updated", "runner.updated"]);
    const requested = await hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.subjectId, projectId), eq(auditEvent.action, "runner.requested")));
    expect(requested.length).toBeGreaterThan(0);
  });

  it("stores the runner's report for the console", async () => {
    expect((await owner("POST", "report", { project_id: projectId, running: 2 })).status).toBe(204);
    expect((await owner("POST", "report", { project_id: projectId, running: 0, error: "gh: not logged in" })).status).toBe(204);
    const html = await (await fetch(`${hub.url}/console/projects`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).toContain("gh: not logged in");
    expect(html).toContain("Stop the runner");
  });

  it("answers 403 to a member and to a guest on every runner route", async () => {
    const t = await create({ title: "forbidden" });
    const routes = [
      ["GET", "targets"],
      ["POST", "report", { project_id: projectId, running: 0 }],
      ["GET", `ready?project=${projectId}`],
      ["POST", "lease", { task_id: t.id, owner: "x" }],
      ["POST", "renew", { task_id: t.id, owner: "x" }],
      ["POST", "update", { task_id: t.id, owner: "x", patch: { note: "x" } }],
    ] as const;
    for (const [method, path, body] of routes) expect((await rest(team.sam.token, method, path, body)).status).toBe(403);
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    for (const [method, path, body] of routes) expect((await rest(team.malik.token, method, path, body)).status).toBe(403);
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
    await set(t.id, { status: "cancelled" });
  });

  it("lets only an owner or an admin flag a task for the runner, never a member or a guest", async () => {
    expect((await create({ title: "flagged" })).runner).toBe(true);
    expect((await create({ title: "default", runner: undefined })).runner).toBe(false);
    const sam = await mcpClient(hub.url, team.sam.token);
    const asMember = await call(sam, "task_create", { agent: samAgentId, title: "member", runner: true });
    expect(JSON.parse(asMember.text).code).toBe("E_FORBIDDEN");
    expect((await call(sam, "task_create", { agent: samAgentId, title: "member, manual" })).isError).toBe(false);
    await hub.db.update(membership).set({ role: "admin" }).where(eq(membership.userId, team.sam.userId));
    const asAdmin = await call(sam, "task_create", { agent: samAgentId, title: "admin", runner: true });
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.sam.userId));
    await sam.close();
    expect(JSON.parse(asAdmin.text).runner).toBe(true);
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    const malik = await mcpClient(hub.url, team.malik.token);
    const r = await call(malik, "task_create", { title: "guest", runner: true });
    await malik.close();
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
    expect(JSON.parse(r.text).code).toBe("E_FORBIDDEN");
    for (const title of ["member", "admin"])
      await hub.db
        .update(task)
        .set({ status: "cancelled" })
        .where(and(eq(task.title, title), eq(task.teamId, team.teamId)));
    const leaked = await hub.db
      .select()
      .from(task)
      .where(and(eq(task.title, "guest"), inArray(task.teamId, [team.teamId])));
    expect(leaked).toHaveLength(0);
  });
});
