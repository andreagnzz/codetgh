import { createHmac } from "node:crypto";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { message, project, thread } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let hookUrl = "";
let SECRET = "";
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  // The admin creates the team's webhook in the console and pastes the URL and secret into their GitHub App.
  const page = await (await consolePost(hub.url, team.lea.cookie, "/console/settings/github")).text();
  hookUrl = page.match(/https?:\/\/\S+\/bridges\/github\/[A-Za-z0-9_-]+/)?.[0] ?? "";
  SECRET = page.match(/Secret: ([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
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
