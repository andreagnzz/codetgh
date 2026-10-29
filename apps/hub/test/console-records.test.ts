import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { auditEvent, project, task } from "../src/db/schema.js";
import { RateLimiter } from "../src/domain/limits.js";
import { call, type Hub, mcpClient, startHub } from "./harness.js";

// Audit log, team memory, claims and tasks: who did what in words with the machine keys underneath, states as words, the
// actions named after their object, and every list saying what fills it when it is empty.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let fresh: Hub;
let freshTeam: Awaited<ReturnType<Hub["seed"]>>;
let clock = 0;
const ids: Record<string, string> = {};

const rest = async (token: string, path: string, body: unknown) => {
  const res = await fetch(`${hub.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const page = async (path: string, cookie: string, lang = "en", h = hub) =>
  (await fetch(`${h.url}${path}`, { headers: { cookie, "accept-language": lang } })).text();
const main = (html: string) => html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
// The page header: the way back, the title, its actions and its meta line.
const head = (html: string) => html.slice(html.indexOf('<div class="page-head">'), html.indexOf('<div class="page-head">') + 3000);
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const post = async (cookie: string, path: string, form: Record<string, string> = {}) => {
  const res = await consolePost(hub.url, cookie, path, form);
  if (res.status >= 400) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
};

beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  const session = async (token: string, id: string, repo: string, branch: string) =>
    (
      (await rest(token, "/v1/agents/session", {
        session_id: id,
        branch,
        repo_fingerprint: (await hub.db.select().from(project).where(eq(project.name, repo)))[0]?.repoFingerprint,
        repo_name: repo,
      })) as { agent_id: string }
    ).agent_id;
  ids.sam = await session(team.sam.token, "sam-web", "acme/webapp", "feat/login");
  ids.malik = await session(team.malik.token, "malik-billing", "acme/billing", "fix/invoice");
  const sam = await mcpClient(hub.url, team.sam.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  const tool = async (client: typeof sam, name: string, args: Record<string, unknown>) => {
    const r = await call(client, name, args);
    if (r.isError) throw new Error(`${name}: ${r.text}`);
    return r.json();
  };
  // Claims: an exclusive glob of Sam's with a reason, a shared resource of Malik's without one.
  await tool(sam, "claim", { agent: ids.sam, scope: ["apps/web/src/login/**"], reason: "Login errors under each field", ttl_s: 3600 });
  await tool(malik, "claim", { agent: ids.malik, scope: ["resource:staging-db"], mode: "shared", ttl_s: 1800 });
  // A direct thread whose subject only its participants and an audited admin may read.
  await tool(sam, "send_message", { agent: ids.sam, to: "@malik", allow_offline: true, kind: "note", subject: "Salary bands", body: "x" });
  // Tasks: one in progress with a note, one blocked, one nobody holds; a done one moved to the archives.
  ids.doing = (await tool(sam, "task_create", { agent: ids.sam, title: "Show login errors under each field", body: "Each field." })).id;
  await tool(sam, "task_claim", { agent: ids.sam, task_id: ids.doing, expected_version: 1 });
  await tool(sam, "task_update", {
    agent: ids.sam,
    task_id: ids.doing,
    expected_version: 2,
    patch: { status: "in_progress", note: "Email and password done." },
  });
  ids.blocked = (await tool(malik, "task_create", { agent: ids.malik, title: "Rotate the staging password" })).id;
  await tool(malik, "task_claim", { agent: ids.malik, task_id: ids.blocked, expected_version: 1 });
  await tool(malik, "task_update", {
    agent: ids.malik,
    task_id: ids.blocked,
    expected_version: 2,
    patch: { status: "blocked", reason: "Waiting for the maintenance window" },
  });
  await post(team.lea.cookie, "/console/tasks", { title: "Prepare the demo" });
  ids.loose = (await hub.db.select().from(task).where(eq(task.title, "Prepare the demo")))[0]?.id ?? "";
  // Team memory: D-1 accepted and pinned, then its v2 proposed by Sam's agent; a rejected note with its reason.
  ids.d1 = (await tool(malik, "memory_propose", { agent: ids.malik, kind: "decision", title: "Dates", body: "Dates are ISO." })).id;
  await post(team.lea.cookie, `/console/memory/${ids.d1}/decide`, { decision: "accept", note: "Agreed at stand-up." });
  await post(team.lea.cookie, `/console/memory/${ids.d1}/pin`, { pinned: "true" });
  ids.d1v2 = (
    await tool(sam, "memory_propose", {
      agent: ids.sam,
      kind: "decision",
      title: "Dates",
      body: "With milliseconds.\nDates are ISO.",
      supersedes: ids.d1,
    })
  ).id;
  ids.note = (await tool(malik, "memory_propose", { agent: ids.malik, kind: "note", title: "Staging resets", body: "Mondays." })).id;
  await post(team.lea.cookie, `/console/memory/${ids.note}/decide`, { decision: "reject", note: "Not since the move." });
  await sam.close();
  await malik.close();

  fresh = await startHub();
  freshTeam = await fresh.seed();
});
afterAll(async () => {
  await hub.stop();
  await fresh.stop();
});

describe("audit log", () => {
  it("says who did what to which object, newest first, with the machine keys underneath", async () => {
    const html = main(await page("/console/audit", team.lea.cookie));
    expect(html).toContain('aria-sort="descending"');
    // A task created by Sam's agent: the person, the session, the action in words, the task's title, the keys in mono.
    const [created] = await hub.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, ids.doing ?? ""));
    const row = html.slice(html.indexOf(`Hashes of event ${created?.seq}`));
    const cells = row.slice(0, row.indexOf("</tr>"));
    expect(cells).toContain(">Sam<");
    expect(cells).toContain(">sam@feat/login</span>");
    expect(cells).toContain(">MCP<");
    expect(cells).toContain(">Task created<");
    // The key breaks after its dot, never inside a word.
    expect(cells).toContain('<code class="rec-key">task.<wbr/>created</code>');
    expect(cells).toContain(">Show login errors under each field<");
    expect(cells).toContain(short(ids.doing ?? ""));
    expect(cells).toContain("data-local");
    // The hash and the previous one wait behind the event's number.
    expect(cells).toContain(created?.hash);
    expect(cells).toContain(created?.prevHash);
    // A person in the console.
    expect(html).toContain(">Memory pinned<");
    expect(html).toContain(">Person<");
  });

  it("never shows the subject of a direct thread", async () => {
    const html = await page("/console/audit", team.lea.cookie);
    expect(html).toContain(">Message sent<");
    expect(html).toContain(">A direct thread<");
    expect(html).not.toContain("Salary bands");
  });

  it("puts Export JSON and Verify chain in the page header, and says how to check an export offline", async () => {
    const top = head(await page("/console/audit", team.lea.cookie));
    expect(top).toContain(">Audit log</h1>");
    expect(top).toMatch(/<a class="button" href="\/console\/audit\/export">Export JSON<\/a>/);
    expect(top).toMatch(/<button type="button" class="secondary" hx-post="\/console\/audit\/verify" hx-target="#verify-result">/);
    expect(top).toContain("<code>codetgh audit verify</code>");
  });

  it("answers Verify chain with a success banner, and names where a broken chain breaks", async () => {
    const ok = await (await consolePost(hub.url, team.lea.cookie, "/console/audit/verify")).text();
    expect(ok).toContain('class="banner" data-tone="success"');
    expect(ok).toContain("Chain intact.");
    expect(ok).toMatch(/\d+ events, \d+ signed checkpoints?, checked just now\./);
    const freshCookie = freshTeam.lea.cookie;
    await fresh.db.update(auditEvent).set({ action: "team.renamed" }).where(eq(auditEvent.seq, 2));
    const broken = await (await consolePost(fresh.url, freshCookie, "/console/audit/verify")).text();
    expect(broken).toContain('class="banner" data-tone="danger"');
    expect(broken).toContain("The chain doesn&#39;t verify.");
    expect(broken).toContain("The hub said: first break at seq 2.");
  });

  it("reads in French", async () => {
    const html = await page("/console/audit", team.lea.cookie, "fr");
    expect(html).toContain(">Journal d&#39;audit</h1>");
    expect(html).toContain(">Tâche créée<");
    expect(html).toContain(">Exporter en JSON</a>");
  });
});
