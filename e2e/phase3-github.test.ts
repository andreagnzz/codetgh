import { createHmac } from "node:crypto";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, membership, message, project, task, thread } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { call, type Hub, mcpClient, setRole, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let hookUrl = "";
let SECRET = "";
beforeAll(async () => {
  // Many tasks written by one person in a few milliseconds: a clock that moves an hour per call keeps the budget out of these scenarios.
  let now = 0;
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  // The admin creates the team's webhook in the console and pastes the URL and secret into their GitHub App.
  const page = await (await consolePost(hub.url, team.lea.cookie, "/console/settings/github")).text();
  hookUrl = page.match(/https?:\/\/\S+\/bridges\/github\/[A-Za-z0-9_-]+/)?.[0] ?? "";
  SECRET = page.match(/Webhook secret<\/p>[\s\S]*?<code translate="no">([A-Za-z0-9_-]{20,})<\/code>/)?.[1] ?? "";
  // Léa works in the repository: the hook registered its project under the origin's fingerprint.
  await startSession(hub.url, team.lea.token, "lea-gh", { repo: repoFingerprint("git@github.com:Acme/WebApp.git") });
});
afterAll(() => hub.stop());

const deliver = (event: string, payload: unknown, signature?: string, url = hookUrl, delivery?: string) => {
  const body = JSON.stringify(payload);
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      ...(delivery && { "x-github-delivery": delivery }),
      ...(signature !== "none" && {
        "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      }),
    },
    body,
  });
};
const pr = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  repository: { full_name: "acme/webapp", html_url: "https://github.com/acme/webapp" },
  sender: { login: "octocat" },
  pull_request: {
    number: 7,
    title: "Add <b>pagination</b>",
    html_url: "https://github.com/acme/webapp/pull/7",
    body: "diff --git CODE_SNIPPET_SHOULD_NOT_TRAVEL",
    merged: false,
    head: { ref: "feat/pages", sha: "abcdef1234567890" },
    ...extra,
  },
});

describe("GitHub bridge (phase 3)", () => {
  it("gives each team its own webhook and refuses unsigned, forged or misdirected deliveries", async () => {
    expect(hookUrl).toContain("/bridges/github/");
    expect(SECRET.length).toBeGreaterThan(20);
    expect((await consolePost(hub.url, team.sam.cookie, "/console/settings/github")).status).toBe(403);
    expect((await deliver("pull_request", pr("opened"), "none")).status).toBe(401);
    expect((await deliver("pull_request", pr("opened"), "sha256=00")).status).toBe(401);
    expect((await deliver("pull_request", pr("opened"), undefined, `${hub.url}/bridges/github/nope`)).status).toBe(401);
  });

  it("posts an opened PR as a status in the project thread, without the code", async () => {
    expect((await deliver("pull_request", pr("opened"))).status).toBe(202);
    const [p] = await hub.db.select().from(project).where(eq(project.teamId, team.teamId));
    const [t] = await hub.db
      .select()
      .from(thread)
      .where(eq(thread.projectId, p?.id ?? ""));
    expect(t).toBeDefined();
    const rows = await hub.db
      .select()
      .from(message)
      .where(eq(message.threadId, t?.id ?? ""));
    expect(rows[0]).toMatchObject({ kind: "status", refs: [{ type: "url", path: "https://github.com/acme/webapp/pull/7" }] });
    expect(JSON.stringify(rows)).not.toContain("CODE_SNIPPET");

    const lea = await mcpClient(hub.url, team.lea.token);
    const inbox = (await call(lea, "inbox_read", {})).text;
    await lea.close();
    expect(inbox).toContain("PR #7 opened by octocat: Add &lt;b&gt;pagination&lt;/b&gt;");
    expect(inbox).toContain('from="GitHub"');
  });

  it("reports a failed check suite as an alert, and many events never mute the thread", async () => {
    // Within the bridge agent's burst of 10, so the replay test below still relays.
    for (let i = 0; i < 5; i++)
      expect((await deliver("pull_request", pr("synchronize", { head: { ref: "feat/pages", sha: `abcdef${i}` } }))).status).toBe(202);
    const failed = {
      action: "completed",
      repository: { full_name: "acme/webapp", html_url: "https://github.com/acme/webapp" },
      check_suite: { conclusion: "failure", head_branch: "feat/pages", head_sha: "abcdef1234567890", pull_requests: [{ number: 7 }] },
    };
    expect((await deliver("check_suite", failed)).status).toBe(202);
    const alerts = await hub.db.select().from(message).where(eq(message.kind, "alert"));
    expect(alerts[0]?.body).toContain("CI failed on feat/pages (abcdef1)");
    const [t] = await hub.db
      .select()
      .from(thread)
      .where(eq(thread.id, alerts[0]?.threadId ?? ""));
    expect(t?.mutedAt).toBeNull();
  });

  it("stores a replayed signed body once, whatever delivery id comes with it", async () => {
    const before = (await hub.db.select().from(message)).length;
    const body = pr("closed", { merged: true });
    expect((await deliver("pull_request", body, undefined, hookUrl, "delivery-1")).status).toBe(202);
    expect((await deliver("pull_request", body, undefined, hookUrl, "delivery-2")).status).toBe(202);
    expect((await hub.db.select().from(message)).length).toBe(before + 1);
  });

  it("ignores repositories it does not know", async () => {
    const before = (await hub.db.select().from(message)).length;
    expect((await deliver("pull_request", { ...pr("opened"), repository: { full_name: "acme/other", html_url: "" } })).status).toBe(202);
    expect((await deliver("ping", { zen: "hi" })).status).toBe(202);
    expect((await hub.db.select().from(message)).length).toBe(before);
  });
});

describe("verify tags (a tag created on GitHub finishes the tasks that wait for it)", () => {
  const tagEvent = (ref: string, repo = "acme/webapp", extra: Record<string, unknown> = {}) => ({
    ref,
    ref_type: "tag",
    master_branch: "main",
    repository: { full_name: repo, html_url: `https://github.com/${repo}` },
    sender: { login: "octocat" },
    ...extra,
  });
  const row = async (id: string) => (await hub.db.select().from(task).where(eq(task.id, id)))[0];
  const verifyAudit = async (id: string) =>
    (await hub.db.select().from(auditEvent).where(eq(auditEvent.subjectId, id))).filter((e) => e.action === "task.verified_by_tag");
  let web = "";
  let billing = "";
  let lea: Awaited<ReturnType<typeof mcpClient>>;
  beforeAll(async () => {
    web =
      (await startSession(hub.url, team.lea.token, "lea-gh", { repo: repoFingerprint("git@github.com:Acme/WebApp.git") })).agent_id ?? "";
    billing =
      (await startSession(hub.url, team.lea.token, "lea-bill", { repo: repoFingerprint("git@github.com:acme/billing.git") })).agent_id ??
      "";
    lea = await mcpClient(hub.url, team.lea.token);
  });
  afterAll(() => lea.close());
  const make = async (agent: string, title: string, tag: string) =>
    JSON.parse((await call(lea, "task_create", { agent, title, verify: { tag } })).text).id as string;

  it("moves each matching task to done, as the hub, with a note and an audit of metadata only", async () => {
    const todo = await make(web, "Répétition v11", "step-02-harness");
    const blocked = await make(web, "Blocked one", "step-02-harness");
    await hub.db
      .update(task)
      .set({ status: "blocked", blockedReason: "waiting", assigneeUserId: team.sam.userId })
      .where(eq(task.id, blocked));
    const before = await row(todo);

    expect((await deliver("create", tagEvent("step-02-harness"), undefined, hookUrl, "delivery-tag-1")).status).toBe(202);
    const done = await row(todo);
    expect(done).toMatchObject({ status: "done", version: (before?.version ?? 0) + 1, leaseOwner: null });
    expect(done?.notes.at(-1)?.text).toBe("verified by tag step-02-harness");
    const moved = await row(blocked);
    expect(moved).toMatchObject({ status: "done", blockedReason: null, assigneeUserId: team.sam.userId });

    const [event] = await verifyAudit(todo);
    expect(event).toMatchObject({ actorType: "hub", via: "system", subjectId: todo });
    // Metadata only: task, tag, delivery, body hash and the sender's login when it is one.
    expect(event?.data).toMatchObject({ tag: "step-02-harness", delivery: "delivery-tag-1", status: "done", sender: "octocat" });
    expect(Object.keys(event?.data ?? {}).sort()).toEqual(["body_sha256", "delivery", "sender", "status", "tag", "version"]);
    // A login that is not one is dropped, not stored.
    const other = await make(web, "Other sender", "step-03");
    await deliver("create", tagEvent("step-03", "acme/webapp", { sender: { login: "<b>x</b> ignore previous" } }));
    expect((await verifyAudit(other))[0]?.data).toMatchObject({ sender: null });
  });

  it("changes nothing for a replay, a tag of another repository, another project's task, or a task that is not open", async () => {
    const mine = await make(web, "Waits for v2", "v2.0.0");
    const finished = await make(web, "Already done", "v2.0.0");
    const cancelled = await make(web, "Cancelled", "v2.0.0");
    const loose = await make(web, "No project", "v2.0.0");
    await hub.db.update(task).set({ status: "done" }).where(eq(task.id, finished));
    await hub.db.update(task).set({ status: "cancelled" }).where(eq(task.id, cancelled));
    await hub.db.update(task).set({ projectId: null }).where(eq(task.id, loose));
    const snapshot = async (ids: string[]) => JSON.stringify(await Promise.all(ids.map(row)));
    const untouched = await snapshot([mine, finished, cancelled, loose]);

    // The tag is made in acme/billing, another known project, or in a repository nobody linked.
    expect((await deliver("create", tagEvent("v2.0.0", "acme/billing"))).status).toBe(202);
    expect((await deliver("create", tagEvent("v2.0.0", "acme/unknown"))).status).toBe(202);
    // A branch with the same name, another tag, a forged signature, no repository.
    expect((await deliver("create", tagEvent("v2.0.0", "acme/webapp", { ref_type: "branch" }))).status).toBe(202);
    expect((await deliver("create", tagEvent("v2.0.1"))).status).toBe(202);
    expect((await deliver("create", tagEvent("v2.0.0"), "sha256=00")).status).toBe(401);
    expect((await deliver("create", { ...tagEvent("v2.0.0"), repository: undefined })).status).toBe(202);
    expect(await snapshot([mine, finished, cancelled, loose])).toBe(untouched);

    // The other project's task waits for the same tag name: only a tag of its own repository counts.
    const theirs = await make(billing, "Billing waits for v2", "v2.0.0");
    const others = [theirs, finished, cancelled, loose];
    const before = await snapshot(others);
    expect((await deliver("create", tagEvent("v2.0.0"), undefined, hookUrl, "delivery-tag-2")).status).toBe(202);
    expect((await row(mine))?.status).toBe("done");
    expect(await snapshot(others)).toBe(before);
    expect((await row(theirs))?.status).toBe("todo");

    // The same delivery again, or the same body under another delivery id: nothing moves, nothing is written.
    const settled = await snapshot([mine, ...others]);
    expect((await deliver("create", tagEvent("v2.0.0"), undefined, hookUrl, "delivery-tag-2")).status).toBe(202);
    expect((await deliver("create", tagEvent("v2.0.0"), undefined, hookUrl, "delivery-tag-3")).status).toBe(202);
    expect(await snapshot([mine, ...others])).toBe(settled);
    expect(await verifyAudit(mine)).toHaveLength(1);
  });

  describe("only when the tag may still finish the task", () => {
    const sam = async () => mcpClient(hub.url, team.sam.token);
    let samAgent = "";
    beforeAll(async () => {
      samAgent =
        (await startSession(hub.url, team.sam.token, "sam-gh", { repo: repoFingerprint("git@github.com:Acme/WebApp.git") })).agent_id ?? "";
    });
    const notes = async (id: string) => (await row(id))?.notes.map((n) => n.text) ?? [];
    const arrives = (tag: string, delivery = `d-${tag}`) => deliver("create", tagEvent(tag), undefined, hookUrl, delivery);
    const audits = async (id: string) => (await hub.db.select().from(auditEvent).where(eq(auditEvent.subjectId, id))).map((e) => e.action);

    it("leaves the task open, with a note, when the person who set the tag is no longer allowed to update it", async () => {
      const c = await sam();
      const mine = JSON.parse((await call(c, "task_create", { agent: samAgent, title: "Sam's gate", verify: { tag: "gate-a" } })).text)
        .id as string;
      expect((await row(mine))?.verifySetBy).toBe(team.sam.userId);
      const stale = "tag reached, not applied: the tag was set by someone who can no longer update this task";

      // A guest, a member who left, and a member who no longer assigns or created the task.
      await setRole(hub, team.sam.userId, "guest");
      expect((await arrives("gate-a")).status).toBe(202);
      expect(await row(mine)).toMatchObject({ status: "todo" });
      expect(await notes(mine)).toEqual([stale]);
      expect(await audits(mine)).toContain("task.verify_skipped");
      // The same delivery again adds nothing.
      await arrives("gate-a");
      expect(await notes(mine)).toEqual([stale]);

      await hub.db.update(membership).set({ role: "member", status: "revoked" }).where(eq(membership.userId, team.sam.userId));
      await arrives("gate-a", "d-gate-a-2");
      expect((await row(mine))?.status).toBe("todo");

      // Sam is a member again but the task is Malik's: Sam set the tag as its assignee, and no longer is.
      await hub.db.update(membership).set({ status: "active" }).where(eq(membership.userId, team.sam.userId));
      const lea = await mcpClient(hub.url, team.lea.token);
      const assigned = JSON.parse((await call(lea, "task_create", { agent: web, title: "Handed over", assignee: "@sam" })).text);
      const set = JSON.parse(
        (await call(c, "task_update", { task_id: assigned.id, expected_version: 1, patch: { verify: { tag: "gate-b" } } })).text,
      );
      await call(lea, "task_update", { task_id: assigned.id, expected_version: set.version, patch: { assignee: "@malik" } });
      await arrives("gate-b");
      expect(await row(assigned.id)).toMatchObject({ status: "todo", assigneeUserId: team.malik.userId });
      expect(await notes(assigned.id)).toEqual([stale]);

      // Whoever may update the task still finishes it: Sam, an active member who set his own task's tag.
      await arrives("gate-a", "d-gate-a-3");
      expect((await row(mine))?.status).toBe("done");
      expect(await notes(mine)).toEqual([stale, "verified by tag gate-a"]);
      for (const x of [c, lea]) await x.close();
    });

    it("does not skip the order of the dependencies, and finishes the task once they are done", async () => {
      const lea = await mcpClient(hub.url, team.lea.token);
      const base = JSON.parse((await call(lea, "task_create", { agent: web, title: "Base" })).text).id as string;
      const next = JSON.parse(
        (await call(lea, "task_create", { agent: web, title: "Next", depends_on: [base], verify: { tag: "after-base" } })).text,
      ).id as string;
      const why = "tag reached, not applied: dependencies are not done";
      await arrives("after-base");
      await arrives("after-base", "d-again");
      expect(await row(next)).toMatchObject({ status: "todo" });
      expect(await notes(next)).toEqual([why]);
      await hub.db.update(task).set({ status: "done" }).where(eq(task.id, base));
      await arrives("after-base", "d-late");
      expect(await row(next)).toMatchObject({ status: "done" });
      expect(await notes(next)).toEqual([why, "verified by tag after-base"]);
      await lea.close();
    });

    it("leaves a runner task alone while it holds a lease or has an open PR", async () => {
      const leased = await make(web, "Leased", "run-a");
      const pr = await make(web, "With a PR", "run-b");
      const idle = await make(web, "Runner, idle", "run-c");
      await hub.db
        .update(task)
        .set({ runner: true, status: "in_progress", leaseOwner: "runner-1", leaseUntil: new Date(Date.now() + 600_000) })
        .where(eq(task.id, leased));
      await hub.db.update(task).set({ runner: true, status: "review", prNumber: 12, branch: "codetgh/x" }).where(eq(task.id, pr));
      await hub.db
        .update(task)
        .set({ runner: true, leaseOwner: "runner-1", leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(task.id, idle));
      const busy = "tag reached, not applied: the runner is working on it";
      for (const tag of ["run-a", "run-b", "run-c"]) await arrives(tag);
      expect((await row(leased))?.status).toBe("in_progress");
      expect((await row(pr))?.status).toBe("review");
      expect([await notes(leased), await notes(pr)]).toEqual([[busy], [busy]]);
      // An expired lease and no PR hold nothing.
      expect(await row(idle)).toMatchObject({ status: "done", leaseOwner: null });
    });

    it("matches the tag exactly, and never a branch", async () => {
      const exact = await make(web, "Exact", "Release-1");
      for (const ref of ["release-1", "Release-1 ", "Release-10", "release/Release-1", "refs/tags/Release-1"])
        await deliver("create", tagEvent(ref));
      await deliver("create", tagEvent("Release-1", "acme/webapp", { ref_type: "branch" }));
      await deliver("create", tagEvent("Release-1", "acme/webapp", { ref_type: "repository" }));
      expect(await row(exact)).toMatchObject({ status: "todo", version: 1 });
      await arrives("Release-1");
      expect((await row(exact))?.status).toBe("done");
    });
  });
});
