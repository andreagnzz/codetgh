import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../db/index.js";
import { project, task, team, thread } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { requireAdmin } from "./admin.js";
import { appendAudit } from "./audit.js";
import { bridgeAuthor, projectThread } from "./bridges.js";
import { type MessagingDeps, sendMessage } from "./messages.js";
import { MAX_NOTES } from "./tasks.js";

// Each team has its own webhook URL and secret, so only the GitHub App its admin configured can post to it.
// The secret is derived from the hub secret and a nonce: rotating the nonce replaces it, and the database never holds it.
export const githubSecret = (hubSecret: string, teamId: string, nonce: string) =>
  createHmac("sha256", hubSecret).update(`github-webhook:${teamId}:${nonce}`).digest("base64url");

export async function createGithubHook(db: Db, p: Principal, hubSecret: string) {
  requireAdmin(p);
  const hook = { id: randomBytes(12).toString("base64url"), nonce: randomBytes(16).toString("base64url") };
  await db.transaction(async (tx) => {
    await tx
      .update(team)
      .set({ settings: sql`${team.settings} || ${JSON.stringify({ github_hook: hook })}::jsonb` })
      .where(eq(team.id, p.teamId));
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: "github.webhook_created",
      subjectId: p.teamId,
    });
  });
  return { id: hook.id, secret: githubSecret(hubSecret, p.teamId, hook.nonce) };
}

export async function teamForGithubHook(db: Db, hookId: string) {
  const [t] = await db
    .select({ id: team.id, settings: team.settings })
    .from(team)
    .where(sql`${team.settings}->'github_hook'->>'id' = ${hookId}`);
  return t?.settings.github_hook ? { teamId: t.id, nonce: t.settings.github_hook.nonce } : null;
}

export function validGithubSignature(secret: string, body: string, header: string | undefined) {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Payload = {
  action?: string;
  // create event: the tag or branch that was made.
  ref?: string;
  ref_type?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    merged?: boolean;
    head?: { ref?: string };
    updated_at?: string;
    closed_at?: string | null;
  };
  check_suite?: { conclusion?: string | null; head_branch?: string | null; head_sha?: string; pull_requests?: Array<{ number?: number }> };
};

const PR_VERBS: Record<string, string> = {
  opened: "opened",
  reopened: "reopened",
  ready_for_review: "ready for review",
  synchronize: "updated",
};

// Metadata only: number, title, link, branch, sha. Never the PR body, diff or files, so the bridge carries no code.
function describe(event: string, e: Payload) {
  const pr = e.pull_request;
  if (event === "pull_request" && pr?.number) {
    const verb = e.action === "closed" ? (pr.merged ? "merged" : "closed") : PR_VERBS[e.action ?? ""];
    if (!verb) return null;
    return {
      kind: "status" as const,
      priority: "normal" as const,
      body: `PR #${pr.number} ${verb} by ${e.sender?.login ?? "someone"}: ${pr.title ?? ""}`,
      refs: pr.html_url ? [{ type: "url" as const, path: pr.html_url }] : [],
    };
  }
  const cs = e.check_suite;
  if (event === "check_suite" && e.action === "completed" && (cs?.conclusion === "failure" || cs?.conclusion === "timed_out")) {
    const prs = (cs.pull_requests ?? []).map((p) => `#${p.number}`).join(", ");
    return {
      kind: "alert" as const,
      priority: "high" as const,
      body: `CI failed on ${cs.head_branch ?? "?"} (${(cs.head_sha ?? "").slice(0, 7)})${prs ? ` for PR ${prs}` : ""}`,
      refs: [],
    };
  }
  return null;
}

// A runner task's PR, matched on the project's repository, its number and its branch `codetgh/<task>`. Each matching event
// newer than the last one applied, as GitHub dates it, is recorded; a close moves the task only from review or
// in_progress: merged to done, unmerged to blocked. A done task never changes, a reopen restores nothing (the owner runs
// codetgh run retry), and a replayed or late delivery is not newer, so it is a no-op. Metadata only.
async function linkRunnerTask(
  db: Db,
  teamId: string,
  projectId: string,
  authorId: string,
  e: Payload,
  meta: { delivery: string | null; bodyHash: string },
) {
  const pr = e.pull_request;
  const closing = e.action === "closed";
  const at = Date.parse((closing ? pr?.closed_at : null) ?? pr?.updated_at ?? "");
  if (!pr?.number || !pr.head?.ref || Number.isNaN(at)) return;
  const when = new Date(at);
  const merged = closing && pr.merged === true;
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(task)
      .where(
        and(
          eq(task.teamId, teamId),
          eq(task.projectId, projectId),
          eq(task.runner, true),
          eq(task.prNumber, pr.number ?? 0),
          eq(task.branch, pr.head?.ref ?? ""),
          ne(task.status, "done"),
          or(isNull(task.prEventAt), lt(task.prEventAt, when)),
        ),
      )
      .for("update");
    if (!t) return;
    const moves = closing && (t.status === "review" || t.status === "in_progress");
    const note = { at: new Date().toISOString(), user_id: authorId, agent_id: null, text: merged ? "merged" : "PR closed without merge" };
    const [row] = await tx
      .update(task)
      .set({
        prEventAt: when,
        ...(moves && {
          status: merged ? ("done" as const) : ("blocked" as const),
          blockedReason: merged ? null : "pr_closed",
          leaseOwner: null,
          leaseUntil: null,
          notes: sql`(${task.notes} || ${JSON.stringify([note])}::jsonb)`,
          version: sql`${task.version} + 1`,
          updatedAt: new Date(),
        }),
      })
      .where(eq(task.id, t.id))
      .returning();
    if (!moves || !row) return;
    if (row.notes.length > MAX_NOTES)
      await tx
        .update(task)
        .set({ notes: row.notes.slice(-MAX_NOTES) })
        .where(eq(task.id, row.id));
    await appendAudit(tx, {
      teamId,
      actorType: "hub",
      via: "system",
      action: merged ? "runner.merged" : "runner.pr_closed",
      subjectId: row.id,
      data: {
        status: row.status,
        version: row.version,
        pr_number: row.prNumber,
        event: merged ? "merged" : "closed",
        delivery: meta.delivery,
        body_sha256: meta.bodyHash,
      },
    });
  });
}

const projectOf = async (db: Db, teamId: string, e: Payload) => {
  if (!e.repository?.full_name) return null;
  const [p] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, teamId), eq(project.repoFingerprint, repoFingerprint(`github.com/${e.repository.full_name}`))));
  return p ?? null;
};

// A tag created in the project's repository finishes the open tasks that wait for it (verify.tag). The hub moves them,
// outside the status machine, as it does for a merge: the tag is a fact seen on GitHub. Same strictness as the merge
// link: this team's project, found by the repository's fingerprint, and only tasks of that project that are not done or
// cancelled, so a replayed or late delivery changes nothing. Metadata only: task, tag, delivery, body hash.
async function verifyByTag(db: Db, teamId: string, e: Payload, meta: { delivery: string | null; bodyHash: string }) {
  const tag = e.ref;
  const p = e.ref_type === "tag" && tag ? await projectOf(db, teamId, e) : null;
  if (!tag || !p) return;
  const author = await bridgeAuthor(db, teamId, "GitHub");
  const note = { at: new Date().toISOString(), user_id: author.p.user.id, agent_id: null, text: `verified by tag ${tag}` };
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(task)
      .set({
        status: "done",
        blockedReason: null,
        leaseOwner: null,
        leaseUntil: null,
        notes: sql`(${task.notes} || ${JSON.stringify([note])}::jsonb)`,
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(task.teamId, teamId), eq(task.projectId, p.id), eq(task.verifyTag, tag), notInArray(task.status, ["done", "cancelled"])),
      )
      .returning();
    for (const row of rows) {
      if (row.notes.length > MAX_NOTES)
        await tx
          .update(task)
          .set({ notes: row.notes.slice(-MAX_NOTES) })
          .where(eq(task.id, row.id));
      await appendAudit(tx, {
        teamId,
        actorType: "hub",
        via: "system",
        action: "task.verified_by_tag",
        subjectId: row.id,
        data: { status: row.status, version: row.version, tag, delivery: meta.delivery, body_sha256: meta.bodyHash },
      });
    }
  });
}

export async function handleGithubEvent(
  deps: MessagingDeps,
  log: Logger,
  teamId: string,
  event: string,
  e: Payload,
  bodyHash: string,
  delivery: string | null = null,
) {
  const { db } = deps;
  if (event === "create") return verifyByTag(db, teamId, e, { delivery, bodyHash });
  const what = describe(event, e);
  const p = what && (await projectOf(db, teamId, e));
  if (!what || !p) return;
  const author = await bridgeAuthor(db, teamId, "GitHub");
  if (event === "pull_request") await linkRunnerTask(db, teamId, p.id, author.p.user.id, e, { delivery, bodyHash });
  const existing = await projectThread(db, teamId, p.id, author.p.user.id);
  try {
    const sent = await sendMessage(
      deps,
      { p: author.p, agent: author.agent, via: "rest" },
      // A replayed delivery (same signed body) is stored once.
      { ...what, to: existing ? `thread:${existing}` : "@team", idempotency_key: bodyHash },
    );
    if (!existing) await db.update(thread).set({ projectId: p.id }).where(eq(thread.id, sent.threadId));
  } catch (err) {
    // A refused relay (rate limit, kill switch, secret in a title) is logged and dropped; GitHub must not retry it.
    if (!(err instanceof HubError)) throw err;
    log.warn({ code: err.code, event }, "github event not relayed");
  }
}
