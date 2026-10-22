import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
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
  repository?: { full_name?: string };
  sender?: { login?: string };
  pull_request?: { number?: number; title?: string; html_url?: string; merged?: boolean; head?: { ref?: string } };
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

// A runner task's PR, found by its number and its branch: merged, the task is done; closed unmerged, it is blocked. The
// hub moves it, audited, from metadata only. A replayed delivery finds nothing left to move.
async function closeRunnerTask(db: Db, teamId: string, projectId: string, authorId: string, e: Payload) {
  const pr = e.pull_request;
  if (e.action !== "closed" || !pr?.number || !pr.head?.ref) return;
  const merged = pr.merged === true;
  const note = { at: new Date().toISOString(), user_id: authorId, agent_id: null, text: merged ? "merged" : "PR closed without merge" };
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(task)
      .set({
        status: merged ? "done" : "blocked",
        leaseOwner: null,
        leaseUntil: null,
        notes: sql`(${task.notes} || ${JSON.stringify([note])}::jsonb)`,
        version: sql`${task.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(task.teamId, teamId),
          eq(task.projectId, projectId),
          eq(task.runner, true),
          eq(task.prNumber, pr.number ?? 0),
          eq(task.branch, pr.head?.ref ?? ""),
          merged ? notInArray(task.status, ["done", "cancelled"]) : inArray(task.status, ["claimed", "in_progress", "review"]),
        ),
      )
      .returning();
    for (const t of rows) {
      if (t.notes.length > MAX_NOTES)
        await tx
          .update(task)
          .set({ notes: t.notes.slice(-MAX_NOTES) })
          .where(eq(task.id, t.id));
      await appendAudit(tx, {
        teamId,
        actorType: "hub",
        via: "system",
        action: merged ? "runner.merged" : "runner.pr_closed",
        subjectId: t.id,
        data: { status: t.status, version: t.version, pr_number: t.prNumber },
      });
    }
  });
}

export async function handleGithubEvent(deps: MessagingDeps, log: Logger, teamId: string, event: string, e: Payload, bodyHash: string) {
  const { db } = deps;
  const what = describe(event, e);
  if (!what || !e.repository?.full_name) return;
  const [p] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, teamId), eq(project.repoFingerprint, repoFingerprint(`github.com/${e.repository.full_name}`))));
  if (!p) return;
  const author = await bridgeAuthor(db, teamId, "GitHub");
  if (event === "pull_request") await closeRunnerTask(db, teamId, p.id, author.p.user.id, e);
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
