import type { TaskStatus } from "@codetgh/shared";
import { REVIEW_ROUNDS } from "@codetgh/shared/rest";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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
const unleased = () => or(isNull(task.leaseUntil), lt(task.leaseUntil, new Date()));
// For the runner's restack: a PR in review, approved or not, and no runner on it.
const restackable = (p: Principal) =>
  and(
    eq(task.teamId, p.teamId),
    eq(task.status, "review"),
    eq(task.runner, true),
    isNotNull(task.prNumber),
    or(isNull(task.assigneeUserId), eq(task.assigneeUserId, p.user.id)),
    projectOn,
    unleased(),
  );
// For the runner's reviewer: also not approved as it is, and rounds left.
const reviewable = (p: Principal) => and(restackable(p), eq(task.approved, false), lt(task.reviewRound, REVIEW_ROUNDS));

const runnerView = async (db: Db, t: Task) => ({
  ...(await view(db, t)),
  project_id: t.projectId,
  branch: t.branch,
  base_branch: t.baseBranch,
  pr_number: t.prNumber,
  review_round: t.reviewRound,
  approved: t.approved,
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

// A runner that stopped renewing lost its task: back to the queue, with no assignee and no lease. A task with a PR goes
// back to review instead, with its assignee, so its PR and rounds are kept.
export async function expireLeases(db: Db) {
  const expired = and(lt(task.leaseUntil, new Date()), inArray(task.status, ["claimed", "in_progress", "review"]));
  await db.transaction(async (tx) => {
    const back = (where: ReturnType<typeof and>, values: Partial<typeof task.$inferInsert>) =>
      tx
        .update(task)
        .set({ ...values, leaseOwner: null, leaseUntil: null, version: sql`${task.version} + 1`, updatedAt: new Date() })
        .where(where)
        .returning();
    const rows = [
      ...(await back(and(expired, isNull(task.prNumber)), { status: "todo", assigneeUserId: null, assigneeAgentId: null })),
      ...(await back(and(expired, isNotNull(task.prNumber)), { status: "review" })),
    ];
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

export async function readyTasks(db: Db, p: Principal, projectId: string, phase?: "review") {
  requireOwner(p);
  await expireLeases(db);
  const rows = await db
    .select()
    .from(task)
    .where(and(phase === "review" ? reviewable(p) : ready(p), eq(task.projectId, projectId)))
    .orderBy(asc(task.createdAt))
    .limit(50);
  return { tasks: await Promise.all(rows.map((t) => runnerView(db, t))) };
}

const leaseView = async (db: Db, p: Principal, row: Task) => {
  const parents = row.dependsOn.length
    ? await db
        .select({ task_id: task.id, branch: task.branch, pr_number: task.prNumber })
        .from(task)
        .where(and(inArray(task.id, row.dependsOn), eq(task.status, "review")))
    : [];
  return { task: await runnerView(db, row), parents, text: await taskView(db, p, row.id) };
};

// Atomic: one UPDATE that matches only a task still ready and not leased, so of two runners exactly one wins. A review
// or restack lease keeps the task in review and its attempts: only the lease is taken.
export async function leaseTask(db: Db, p: Principal, taskId: string, owner: string, phase?: "review" | "restack") {
  requireLive(p);
  const lease = {
    leaseOwner: owner,
    leaseUntil: new Date(Date.now() + LEASE_MS),
    version: sql`${task.version} + 1`,
    updatedAt: new Date(),
  };
  const row = await db.transaction(async (tx) => {
    const [t] = phase
      ? await tx
          .update(task)
          .set(lease)
          .where(and(eq(task.id, taskId), phase === "review" ? reviewable(p) : restackable(p)))
          .returning()
      : await tx
          .update(task)
          .set({ ...lease, status: "claimed", assigneeUserId: p.user.id, assigneeAgentId: null, attempts: sql`${task.attempts} + 1` })
          .where(and(eq(task.id, taskId), ready(p), unleased()))
          .returning();
    if (!t) throw new HubError("E_VERSION_CONFLICT", `task ${taskId} is not ready any more: read the queue again`);
    await audit(tx, p, "runner.leased", t, { attempts: t.attempts, ...(phase && { phase }) });
    return t;
  });
  return leaseView(db, p, row);
}

// What a restarted runner resumes: the live leases under its stable id.
export async function runnerLeases(db: Db, p: Principal, owner: string) {
  requireOwner(p);
  await expireLeases(db);
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.teamId, p.teamId), eq(task.leaseOwner, owner), gt(task.leaseUntil, new Date())))
    .orderBy(asc(task.createdAt))
    .limit(50);
  return { leases: await Promise.all(rows.map((t) => leaseView(db, p, t))) };
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

// The task machine, plus review → blocked: the reviewer's last round failed.
const runnerAllowed = (from: TaskStatus): TaskStatus[] => (from === "review" ? [...ALLOWED.review, "blocked"] : ALLOWED[from]);

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
    approved?: boolean;
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
  // Done comes from the merge, never from the runner.
  if (patch.status === "done") throw new HubError("E_INVALID", "a runner never sets done: the merge of the PR does");
  if (patch.status && patch.status !== current.status && !runnerAllowed(current.status).includes(patch.status))
    throw new HubError("E_INVALID", `${current.status} → ${patch.status} is not allowed`);
  const status = patch.status ?? current.status;
  const keepLease = status === "claimed" || status === "in_progress";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(task)
      .set({
        status,
        // A fixed code from the runner's own note, never its text.
        blockedReason: status === "blocked" ? blockedCode(patch.note) : null,
        ...(patch.branch && { branch: patch.branch }),
        ...(patch.base_branch && { baseBranch: patch.base_branch }),
        ...(patch.pr_number !== undefined && { prNumber: patch.pr_number }),
        ...(patch.review_round !== undefined && { reviewRound: patch.review_round }),
        ...(patch.approved !== undefined && { approved: patch.approved }),
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

// The runner's fixed notes, as codes: what `codetgh run status` shows for a blocked task, never the note itself.
const BLOCKED_REASONS: Array<[RegExp, string]> = [
  [/^restack conflict$/, "restack_conflict"],
  [/^PR closed without merge$/, "pr_closed"],
  [/^\d+ review rounds without approval/, "review_rounds"],
  [/quarantined/, "quarantined"],
  [/^blocked: /, "runner_error"],
];
const blockedCode = (note = "") => BLOCKED_REASONS.find(([re]) => re.test(note))?.[1] ?? "other";
const DAY_MS = 24 * 3600_000;

// A project's runner tasks: the open ones, and those done in the last day, which the runner also cleans up after.
export async function runnerStatus(db: Db, p: Principal, projectId: string) {
  requireOwner(p);
  await expireLeases(db);
  const rows = await db
    .select({ t: task, ready: sql<boolean>`(${task.status} = 'todo' and ${depsReady})` })
    .from(task)
    .where(
      and(
        eq(task.teamId, p.teamId),
        eq(task.projectId, projectId),
        eq(task.runner, true),
        or(
          inArray(task.status, ["todo", "claimed", "in_progress", "review", "blocked"]),
          and(eq(task.status, "done"), gt(task.updatedAt, new Date(Date.now() - DAY_MS))),
        ),
      ),
    )
    .orderBy(asc(task.createdAt))
    .limit(200);
  const bases = [...new Set(rows.flatMap((r) => (r.t.baseBranch ? [r.t.baseBranch] : [])))];
  const parents = bases.length
    ? await db
        .select({ id: task.id, status: task.status, branch: task.branch })
        .from(task)
        .where(and(eq(task.teamId, p.teamId), inArray(task.branch, bases)))
    : [];
  return {
    tasks: await Promise.all(
      rows.map(async ({ t, ready }) => {
        const parent = parents.find((x) => x.branch === t.baseBranch && t.dependsOn.includes(x.id));
        const note = t.notes.at(-1)?.text ?? "";
        return {
          ...(await runnerView(db, t)),
          ready: !!ready,
          blocked_reason: t.status === "blocked" ? blockedCode(note) : null,
          parent: parent?.branch ? { task_id: parent.id, status: parent.status, branch: parent.branch } : null,
        };
      }),
    ),
  };
}

// The owner's retry: a blocked runner task back to todo (ALLOWED), with no lease, no assignee and its rounds at 0.
export async function retryTask(db: Db, p: Principal, taskId: string) {
  requireLive(p);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(task)
      .set({
        status: "todo",
        blockedReason: null,
        assigneeUserId: null,
        assigneeAgentId: null,
        leaseOwner: null,
        leaseUntil: null,
        reviewRound: 0,
        approved: false,
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, taskId), eq(task.teamId, p.teamId), eq(task.runner, true), eq(task.status, "blocked")))
      .returning();
    if (!row) throw new HubError("E_INVALID", `${taskId} is not a blocked runner task of this team`);
    await audit(tx, p, "runner.retried", row);
    return runnerView(tx, row);
  });
}
