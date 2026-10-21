import type { TaskStatus } from "@codetgh/shared";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { project, runTarget, task } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";
import { assertNoSecrets, type MessagingDeps } from "./messages.js";
import { ALLOWED, MAX_NOTES, taskView, view } from "./tasks.js";

type Task = typeof task.$inferSelect;

// The owner's runner (SPEC « Lanceur et runner »): the hub only keeps the queue and the leases. Which folder and which
// command run is decided by the runner's own config on the owner's machine; the hub never sends a path or a command.
const LEASE_MS = 10 * 60_000;

const requireOwner = (p: Principal) => {
  if (p.role !== "owner") throw new HubError("E_FORBIDDEN", "only the team owner runs the runner");
};
const requireLive = (p: Principal) => {
  requireOwner(p);
  if (p.paused) throw new HubError("E_KILL_SWITCH", "CodeTgh is paused by an admin");
};

// A task is ready when every dependency is done, or in review with a PR the runner can stack on.
// Raw SQL with "task" spelled out: inside the subquery an unqualified column would resolve to `dep`.
const depsReady = sql`not exists (select 1 from "task" as dep where dep.id = any("task"."depends_on")
  and not (dep.status = 'done' or (dep.status = 'review' and dep.pr_number is not null)))`;
const projectOn = sql`exists (select 1 from "run_target" as rt where rt.project_id = "task"."project_id" and rt.desired)`;
const ready = (p: Principal) =>
  and(
    eq(task.teamId, p.teamId),
    eq(task.status, "todo"),
    eq(task.runner, true),
    or(isNull(task.assigneeUserId), eq(task.assigneeUserId, p.user.id)),
    depsReady,
    projectOn,
  );

const runnerView = async (db: Db, t: Task) => ({
  ...(await view(db, t)),
  branch: t.branch,
  base_branch: t.baseBranch,
  pr_number: t.prNumber,
  review_round: t.reviewRound,
  attempts: t.attempts,
  lease_until: t.leaseUntil?.toISOString() ?? null,
});

const audit = (tx: Db, p: Principal, action: string, t: Task, data: Record<string, unknown> = {}) =>
  appendAudit(tx, {
    teamId: p.teamId,
    actorType: "user",
    actorUserId: p.user.id,
    via: "rest",
    action,
    subjectId: t.id,
    data: { status: t.status, version: t.version, ...data },
  });

export async function setRunDesired(db: Db, p: Principal, projectId: string, on: boolean) {
  requireOwner(p);
  await db.transaction(async (tx) => {
    const [pr] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, p.teamId)));
    if (!pr) throw new HubError("E_NOT_FOUND", "project not found");
    const values = { desired: on, updatedBy: p.user.id, updatedAt: new Date() };
    await tx
      .insert(runTarget)
      .values({ projectId, teamId: p.teamId, ...values })
      .onConflictDoUpdate({ target: runTarget.projectId, set: values });
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: on ? "runner.requested" : "runner.stopped",
      subjectId: projectId,
    });
  });
}

export async function runTargets(db: Db, p: Principal) {
  requireOwner(p);
  const rows = await db
    .select({ projectId: runTarget.projectId, name: project.name, desired: runTarget.desired })
    .from(runTarget)
    .innerJoin(project, eq(project.id, runTarget.projectId))
    .where(eq(runTarget.teamId, p.teamId));
  return { targets: rows.map((r) => ({ project_id: r.projectId, project_name: r.name, desired: r.desired })) };
}

export async function reportRun(db: Db, p: Principal, input: { project_id: string; running: number; error?: string }) {
  requireOwner(p);
  await db
    .update(runTarget)
    .set({ running: input.running, reportedAt: new Date(), reportedError: input.error?.slice(0, 300) ?? null })
    .where(and(eq(runTarget.projectId, input.project_id), eq(runTarget.teamId, p.teamId)));
}

export async function runStates(db: Db, teamId: string) {
  return db.select().from(runTarget).where(eq(runTarget.teamId, teamId));
}

// A runner that stopped renewing lost its task: back to the queue, with no assignee and no lease.
export async function expireLeases(db: Db) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(task)
      .set({
        status: "todo",
        leaseOwner: null,
        leaseUntil: null,
        assigneeUserId: null,
        assigneeAgentId: null,
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(lt(task.leaseUntil, new Date()), inArray(task.status, ["claimed", "in_progress"])))
      .returning();
    for (const t of rows)
      await appendAudit(tx, {
        teamId: t.teamId,
        actorType: "hub",
        via: "system",
        action: "runner.lease_expired",
        subjectId: t.id,
        data: { status: t.status, version: t.version },
      });
  });
}

export async function readyTasks(db: Db, p: Principal, projectId: string) {
  requireOwner(p);
  await expireLeases(db);
  const rows = await db
    .select()
    .from(task)
    .where(and(ready(p), eq(task.projectId, projectId)))
    .orderBy(asc(task.createdAt))
    .limit(50);
  return { tasks: await Promise.all(rows.map((t) => runnerView(db, t))) };
}

// Atomic: one UPDATE that matches only a task still ready and not leased, so of two runners exactly one wins.
export async function leaseTask(db: Db, p: Principal, taskId: string, owner: string) {
  requireLive(p);
  const row = await db.transaction(async (tx) => {
    const [t] = await tx
      .update(task)
      .set({
        status: "claimed",
        assigneeUserId: p.user.id,
        assigneeAgentId: null,
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        attempts: sql`${task.attempts} + 1`,
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, taskId), ready(p), or(isNull(task.leaseUntil), lt(task.leaseUntil, new Date()))))
      .returning();
    if (!t) throw new HubError("E_VERSION_CONFLICT", `task ${taskId} is not ready any more: read the queue again`);
    await audit(tx, p, "runner.leased", t, { attempts: t.attempts });
    return t;
  });
  const parents = row.dependsOn.length
    ? await db
        .select({ task_id: task.id, branch: task.branch, pr_number: task.prNumber })
        .from(task)
        .where(and(inArray(task.id, row.dependsOn), eq(task.status, "review")))
    : [];
  return { task: await runnerView(db, row), parents, text: await taskView(db, p, row.id) };
}

export async function renewLease(db: Db, p: Principal, taskId: string, owner: string) {
  requireLive(p);
  const [t] = await db
    .update(task)
    .set({ leaseUntil: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(task.id, taskId), eq(task.teamId, p.teamId), eq(task.leaseOwner, owner)))
    .returning({ leaseUntil: task.leaseUntil });
  if (!t?.leaseUntil) throw new HubError("E_VERSION_CONFLICT", `this runner no longer holds task ${taskId}: stop working on it`);
  return { lease_until: t.leaseUntil.toISOString() };
}

// The lease is the guard: only its holder changes the task, and only along the task status machine.
export async function runnerUpdate(
  deps: MessagingDeps,
  p: Principal,
  taskId: string,
  owner: string,
  patch: {
    status?: TaskStatus;
    branch?: string;
    base_branch?: string;
    pr_number?: number;
    review_round?: number;
    note?: string;
  },
) {
  requireLive(p);
  const { db } = deps;
  if (patch.note) await assertNoSecrets(deps, { p, agent: null, via: "rest" }, patch.note);
  const [current] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.teamId, p.teamId)));
  if (!current) throw new HubError("E_NOT_FOUND", `no task ${taskId}`);
  if (current.leaseOwner !== owner)
    throw new HubError("E_VERSION_CONFLICT", `this runner no longer holds task ${taskId}: stop working on it`);
  if (patch.status && patch.status !== current.status && !ALLOWED[current.status].includes(patch.status))
    throw new HubError("E_INVALID", `${current.status} → ${patch.status} is not allowed`);
  const status = patch.status ?? current.status;
  const keepLease = status === "claimed" || status === "in_progress";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(task)
      .set({
        status,
        ...(patch.branch && { branch: patch.branch }),
        ...(patch.base_branch && { baseBranch: patch.base_branch }),
        ...(patch.pr_number !== undefined && { prNumber: patch.pr_number }),
        ...(patch.review_round !== undefined && { reviewRound: patch.review_round }),
        ...(!keepLease && { leaseOwner: null, leaseUntil: null }),
        ...(status === "todo" && { assigneeUserId: null, assigneeAgentId: null }),
        ...(patch.note && {
          notes: sql`(${task.notes} || ${JSON.stringify([{ at: new Date().toISOString(), user_id: p.user.id, agent_id: null, text: patch.note }])}::jsonb)`,
        }),
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, taskId), eq(task.version, current.version), eq(task.leaseOwner, owner)))
      .returning();
    if (!row) throw new HubError("E_VERSION_CONFLICT", `task ${taskId} changed: read it again`);
    if (row.notes.length > MAX_NOTES)
      await tx
        .update(task)
        .set({ notes: row.notes.slice(-MAX_NOTES) })
        .where(eq(task.id, row.id));
    await audit(tx, p, "runner.updated", row, { fields: Object.keys(patch) });
    return runnerView(tx, row);
  });
}
