import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, membership, project } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { additionalContext, consolePost, gitRepo, hookEnv, runHook, systemMessage } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const CLIENT = "git@github.com:client-under-nda/secret-app.git";
const ASK_ADMIN =
  "CodeTgh: this repository is not a team project yet, so CodeTgh stays off here. Ask an admin to link it with: codetgh project new <name> (run in the repository).";
const projectsOf = (origin: string) =>
  hub.db
    .select()
    .from(project)
    .where(eq(project.repoFingerprint, repoFingerprint(origin)));

it("links a member's new repository as a team project named after it", async () => {
  const repo = gitRepo("git@github.com:acme/landing-page.git");
  const r = await runHook("session-start", { session_id: "sam-auto", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  expect(systemMessage(r)).toMatch(/^CodeTgh ✓ landing-page · @sam/);
  const [prj] = await projectsOf("git@github.com:acme/landing-page.git");
  expect(prj?.name).toBe("landing-page");
  const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-auto"));
  expect(row?.projectId).toBe(prj?.id);

  const lea = await mcpClient(hub.url, team.lea.token);
  await startSession(hub.url, team.lea.token, "lea-auto", { repo: ACME_REPO });
  expect((await call(lea, "team_overview", { scope: "team" })).text).toContain("landing-page");
  const html = await (await fetch(`${hub.url}/console/projects`, { headers: { cookie: team.lea.cookie } })).text();
  expect(html).toContain("landing-page");
});

it("does not link a repository for a guest, and says to ask an admin", async () => {
  await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
  const repo = gitRepo(CLIENT);
  const r = await runHook("session-start", { session_id: "malik-nda", source: "startup", cwd: repo }, hookEnv(hub.url, team.malik.token));
  await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
  expect(r.out).toEqual({ systemMessage: ASK_ADMIN });
  expect(await projectsOf(CLIENT)).toHaveLength(0);
  expect(await hub.db.select().from(agent).where(eq(agent.sessionId, "malik-nda"))).toHaveLength(0);
});

it("does not link a repository once an admin turns auto-linking off", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "" });
  const repo = gitRepo(CLIENT);
  const r = await runHook("session-start", { session_id: "sam-nda", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  expect(r.out).toEqual({ systemMessage: ASK_ADMIN });
  expect(await projectsOf(CLIENT)).toHaveLength(0);
  expect(await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-nda"))).toHaveLength(0);
});

it("sends nothing but the fingerprint from an unlinked repository: no branch, no name, no paths", async () => {
  const seen: Array<{ path: string; body: string }> = [];
  const spy = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body });
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ agent_id: null, paused: false, context: "", linked: false }));
    });
  });
  await new Promise<void>((r) => spy.listen(0, "127.0.0.1", r));
  const env = hookEnv(`http://127.0.0.1:${(spy.address() as AddressInfo).port}`, team.sam.token);
  const repo = gitRepo(CLIENT);
  await runHook("session-start", { session_id: "sam-nda-2", source: "startup", cwd: repo }, env);
  await runHook(
    "pre-edit",
    { session_id: "sam-nda-2", cwd: repo, tool_name: "Edit", tool_input: { file_path: join(repo, "src/payroll.ts") } },
    env,
  );
  await runHook("user-prompt-submit", { session_id: "sam-nda-2", prompt: "go" }, env);
  await runHook("stop", { session_id: "sam-nda-2", cwd: repo }, env);
  spy.close();

  expect(seen.map((s) => s.path)).toEqual(["/v1/agents/session"]);
  const sent = JSON.parse(seen[0]?.body ?? "{}");
  expect(sent.repo_fingerprint).toBe(repoFingerprint(CLIENT));
  expect(sent.branch).toBeUndefined();
  expect(sent.repo_name).toBeUndefined();
});

it("still works in a linked repository", async () => {
  const repo = gitRepo("git@github.com:acme/webapp.git");
  const r = await runHook("session-start", { session_id: "sam-linked", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  expect(additionalContext(r)).toContain("codetgh_context");
});

// Seen on the first session in a new repository: the hub created the project but answered after the hook's budget.
it("says the repository is being linked, not that the hub is unreachable, when linking runs out of time", async () => {
  let calls = 0;
  const slow = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls += 1;
      if (calls === 1)
        return res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ agent_id: null, paused: false, context: "", linked: false, can_link: true }));
      setTimeout(() => res.writeHead(200).end("{}"), 8000).unref();
    });
  });
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
  const env = hookEnv(`http://127.0.0.1:${(slow.address() as AddressInfo).port}`, team.sam.token);
  const r = await runHook(
    "session-start",
    { session_id: "sam-slow-link", source: "startup", cwd: gitRepo("git@github.com:acme/bet-predict.git") },
    env,
  );
  slow.close();
  expect(calls).toBe(2);
  expect(systemMessage(r)).not.toMatch(/unreachable/);
  expect(systemMessage(r)).toMatch(/bet-predict/);
  expect(systemMessage(r)).toMatch(/next session|restart/i);
});

it("delivers again once an admin links the repository and the session resumes", async () => {
  const origin = "git@github.com:acme/late-link.git";
  const repo = gitRepo(origin);
  const env = hookEnv(hub.url, team.sam.token);
  const start = await runHook("session-start", { session_id: "sam-late", source: "startup", cwd: repo }, env);
  expect(start.out).toEqual({ systemMessage: ASK_ADMIN });

  const linked = await fetch(`${hub.url}/v1/projects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "late-link", repo_fingerprint: repoFingerprint(origin) }),
  });
  expect(linked.status).toBeLessThan(300);
  const resumed = await runHook("session-start", { session_id: "sam-late", source: "resume", cwd: repo }, env);
  expect(systemMessage(resumed)).toMatch(/^CodeTgh ✓ late-link · @sam/);

  const lea = await mcpClient(hub.url, team.lea.token);
  // Delivery follows the project: Léa writes from a session on it.
  const from = (await startSession(hub.url, team.lea.token, "lea-late", { repo: repoFingerprint(origin) })).agent_id;
  await call(lea, "send_message", { agent: from, to: "@sam", kind: "note", body: "late-link is wired" });
  await lea.close();
  const prompt = await runHook("user-prompt-submit", { session_id: "sam-late", prompt: "go" }, env);
  expect(JSON.stringify(prompt.out)).toContain("late-link is wired");
});
