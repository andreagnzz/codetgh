import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { auditEvent, claim, memoryItem, project, task } from "../src/db/schema.js";
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
let projects: Record<string, string> = {};

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
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const post = async (cookie: string, path: string, form: Record<string, string> = {}) => {
  const res = await consolePost(hub.url, cookie, path, form);
  if (res.status >= 400) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
};

beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  projects = Object.fromEntries((await hub.db.select().from(project)).map((pr) => [pr.name, pr.id]));
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

describe("team memory", () => {
  it("shows one status at a time in tabs with their counts, proposals first", async () => {
    const html = main(await page("/console/memory", team.lea.cookie));
    expect(html).toMatch(/<a href="\/console\/memory\?status=proposed" aria-current="page">Proposed<span class="count">1<\/span><\/a>/);
    expect(html).toContain('href="/console/memory?status=accepted">Accepted<span class="count">1</span>');
    expect(html).toContain('href="/console/memory?status=rejected">Rejected<span class="count">1</span>');
    expect(html).toContain('href="/console/memory?status=all">All<span class="count">3</span>');
    // The item: its ref and version to type, its title as the row's link, its kind and who proposed it.
    expect(html).toContain(">D-1 v2</span>");
    expect(html).toContain(`<a class="row-link" href="/console/memory/${ids.d1v2}">Dates</a>`);
    expect(html).toContain(">Decision<");
    expect(html).toContain(">sam@feat/login</span>");
    // On a status's tab the status column would repeat it; only All shows it, as a pill.
    expect(html).not.toContain('class="pill"');
    const all = main(await page("/console/memory?status=all", team.lea.cookie));
    expect(all).toContain('<span class="pill" data-tone="warn">Proposed</span>');
    expect(all).toContain('<span class="pill" data-tone="ok">Accepted</span>');
    expect(all).toContain('<span class="pill" data-tone="neutral">Pinned</span>');
  });

  it("says what fills an empty tab", async () => {
    const html = main(await page("/console/memory?status=superseded", team.lea.cookie));
    expect(html).toContain('<p class="empty-title">Nothing replaced yet.</p>');
    const none = main(await page("/console/memory", freshTeam.lea.cookie, "en", fresh));
    expect(none).toContain('<p class="empty-title">No proposals to review.</p>');
    expect(none).toContain("memory_propose");
  });

  it("shows a new version as changes from the one it replaces, and the decision form under it", async () => {
    const html = await page(`/console/memory/${ids.d1v2}`, team.lea.cookie);
    expect(head(html)).toContain(">Dates</h1>");
    expect(head(html)).toContain('href="/console/memory?status=proposed">Back to team memory</a>');
    const body = main(html);
    expect(body).toContain(">Changes from v1</h2>");
    expect(body).toContain('<ins class="add">With milliseconds.</ins>');
    expect(body).toContain('<span class="same">Dates are ISO.</span>');
    expect(body).toContain(`<a href="/console/memory/${ids.d1}">D-1 v1</a>`);
    expect(body).toContain('hx-post="/console/memory/');
    expect(body).toMatch(/<input id="decision-note" name="note" maxlength="500"/);
    expect(body).toMatch(/<button type="submit" class="primary" name="decision" value="accept">Accept<\/button>/);
    expect(body).toMatch(/<button type="submit" class="secondary" name="decision" value="reject">Reject<\/button>/);
  });

  it("shows an accepted item's decision, its pin in the page header, and what replaces it", async () => {
    const html = await page(`/console/memory/${ids.d1}`, team.lea.cookie);
    expect(head(html)).toContain('hx-post="/console/memory/');
    expect(head(html)).toContain(">Unpin</button>");
    expect(head(html)).toContain('<span class="pill" data-tone="neutral">Pinned</span>');
    const body = main(html);
    expect(body).toContain("Agreed at stand-up.");
    expect(body).toContain(`<a href="/console/memory/${ids.d1v2}">D-1 v2</a>`);
    const rejected = main(await page(`/console/memory/${ids.note}`, team.lea.cookie));
    expect(rejected).toContain("Not since the move.");
    expect(rejected).not.toContain("/decide");
  });

  it("tells a person whose role can't decide who does", async () => {
    await hub.db
      .update(memoryItem)
      .set({ status: "proposed" })
      .where(eq(memoryItem.id, ids.note ?? ""));
    await post(team.lea.cookie, "/console/settings", { memory_accept_by: "admin" });
    const html = main(await page(`/console/memory/${ids.note}`, team.sam.cookie));
    expect(html).not.toContain("/decide");
    expect(html).toContain("On this hub, only admins and owners accept or reject proposals.");
    await post(team.lea.cookie, "/console/settings", { memory_accept_by: "member" });
    await hub.db
      .update(memoryItem)
      .set({ status: "rejected" })
      .where(eq(memoryItem.id, ids.note ?? ""));
  });

  it("reads in French", async () => {
    const html = main(await page("/console/memory?status=all", team.lea.cookie, "fr"));
    expect(html).toContain(">Proposé</span>");
    expect(html).toContain(">Décision<");
    expect(await page(`/console/memory/${ids.d1v2}`, team.lea.cookie, "fr")).toContain(">Modifications depuis la v1</h2>");
  });
});

describe("claims", () => {
  it("lists what agents work on: the scope to type, who holds it and from which session, the mode and when it ends", async () => {
    const html = main(await page("/console/claims", team.lea.cookie));
    expect(html).toContain('<code class="claim-scope">apps/web/src/login/**</code>');
    // What kind of scope, and how much of it the holder keeps to themselves, under it.
    expect(html).toContain(">Pattern · <span>Exclusive</span>");
    expect(html).toContain(">Resource · <span>Shared</span>");
    expect(html).toContain(">sam@feat/login</span>");
    expect(html).toContain("Login errors under each field");
    expect(html).toContain(">No reason given<");
    expect(html).toMatch(/datetime="[^"]+" data-local/);
  });

  it("lets only an admin release a claim, after asking, in a button named after its scope", async () => {
    const [c] = await hub.db.select().from(claim).where(eq(claim.scope, "apps/web/src/login/**"));
    const html = main(await page("/console/claims", team.lea.cookie));
    const button = html.match(new RegExp(`<button[^>]*hx-post="/console/claims/${c?.id}/release"[^>]*>`))?.[0] ?? "";
    // Freeing a claim deletes nothing: a plain button, the dialog's own button does it.
    expect(button).not.toContain("danger");
    expect(button).toContain('aria-label="Release apps/web/src/login/**…"');
    expect(button).toContain('data-confirm="Release the claim on apps/web/src/login/**?"');
    expect(button).toContain('data-confirm-action="Release"');
    const member = main(await page("/console/claims", team.sam.cookie));
    expect(member).not.toContain("/release");
    expect(member).not.toContain(">Actions<");
  });

  it("says what a claim is when there is none", async () => {
    const html = main(await page("/console/claims", freshTeam.lea.cookie, "en", fresh));
    expect(html).toContain('<p class="empty-title">No active claims.</p>');
    expect(html).toContain("claim tool");
  });

  it("reads in French", async () => {
    const html = main(await page("/console/claims", team.lea.cookie, "fr"));
    expect(html).toContain(">Partagée<");
    expect(html).toContain(">Libérer…</button>");
  });
});

describe("tasks", () => {
  it("groups the board by project, then status in words with its count", async () => {
    const html = main(await page("/console/tasks?project=", team.lea.cookie));
    const webapp = section(html, `p-${projects["acme/webapp"]}`);
    expect(webapp).toContain('In progress <span class="count">1</span></h3>');
    expect(webapp).toContain(`href="/console/tasks/${ids.doing}">Show login errors under each field</a>`);
    expect(webapp).toContain(">@sam</span>");
    const billing = section(html, `p-${projects["acme/billing"]}`);
    expect(billing).toContain('Blocked <span class="count">1</span></h3>');
    expect(billing).toContain("Waiting for the maintenance window");
    const outside = section(html, "p-none");
    expect(outside).toContain('To do <span class="count">1</span></h3>');
    expect(outside).toContain(">Unassigned<");
    expect(html).not.toContain("in_progress");
  });

  it("opens the New task form from the page header, with its fields labelled and Create task as its one primary", async () => {
    const top = head(await page("/console/tasks", team.lea.cookie));
    expect(top).toContain('<div class="new-task"><details class="panel"><summary>New task</summary>');
    const html = await page("/console/tasks", team.lea.cookie);
    const form = html.slice(html.indexOf('<form hx-post="/console/tasks" hx-swap="none">'));
    expect(form).toContain('<label for="task-title">Title</label>');
    expect(form).toMatch(/<input id="task-title" name="title" required="" maxlength="200"/);
    expect(form).toMatch(/<textarea id="task-body" name="body" maxlength="8000"/);
    expect(form).toContain("A handle like @lea. Leave it empty for nobody.");
    expect(form).toMatch(/<input id="task-assignee" name="assignee"/);
    expect(form).toContain('<button type="submit" class="primary">Create task</button>');
  });

  it("says what fills an empty board, a project without tasks and empty archives", async () => {
    const none = main(await page("/console/tasks?project=", freshTeam.lea.cookie, "en", fresh));
    expect(none).toContain('<p class="empty-title">No tasks yet.</p>');
    const latency = (await fresh.db.select().from(project).where(eq(project.name, "acme/latency")))[0]?.id;
    const filtered = main(await page(`/console/tasks?project=${latency}`, freshTeam.lea.cookie, "en", fresh));
    expect(filtered).toContain('<p class="empty-title">No tasks in acme/latency.</p>');
    expect(filtered).toContain('href="/console/tasks?project="');
    const archives = main(await page("/console/tasks?archived=1&project=", freshTeam.lea.cookie, "en", fresh));
    expect(archives).toContain('<p class="empty-title">No archived tasks.</p>');
  });

  it("shows a task's state, its properties, and its history and notes in one timeline", async () => {
    const html = await page(`/console/tasks/${ids.doing}`, team.lea.cookie);
    expect(head(html)).toContain(">Show login errors under each field</h1>");
    expect(head(html)).toContain('<span class="pill" data-tone="neutral">In progress</span>');
    const body = main(html);
    expect(body).toContain('aria-label="About this task"');
    expect(body).toContain(">acme/webapp</span>");
    expect(body).toContain('<ol class="timeline">');
    expect(body).toContain(">created the task<");
    expect(body).toContain(">claimed the task<");
    expect(body).toContain(">moved the task to In progress<");
    expect(body).toContain("Email and password done.");
  });

  it("offers only the statuses the task can move to, in words, with the field names unchanged", async () => {
    const html = main(await page(`/console/tasks/${ids.doing}`, team.lea.cookie));
    const select = html.slice(html.indexOf('<select id="task-status" name="status">'), html.indexOf("</select>"));
    expect(select).toContain('<option value="">Unchanged</option>');
    for (const [value, label] of [
      ["blocked", "Blocked"],
      ["review", "In review"],
      ["done", "Done"],
      ["todo", "To do"],
    ])
      expect(select).toContain(`<option value="${value}">${label}</option>`);
    expect(select).not.toContain('value="cancelled"');
    expect(select).not.toContain('value="claimed"');
    expect(html).toContain('name="expected_version" value="3"');
    expect(html).toMatch(/<input id="task-assignee" name="assignee"/);
    expect(html).toMatch(/<input id="task-reason" name="reason" maxlength="200"/);
    expect(html).toMatch(/<input id="task-note" name="note" maxlength="500"/);
  });

  it("reads in French", async () => {
    const html = main(await page("/console/tasks?project=", team.lea.cookie, "fr"));
    expect(html).toContain('En cours <span class="count">1</span></h3>');
    expect(html).toContain(">Non attribuée<");
    expect(main(await page(`/console/tasks/${ids.doing}`, team.lea.cookie, "fr"))).toContain(">a créé la tâche<");
  });

  it("lets a person change why a blocked task is blocked, from its page", async () => {
    const html = main(await page(`/console/tasks/${ids.blocked}`, team.lea.cookie));
    const select = html.slice(html.indexOf('<select id="task-status" name="status">'), html.indexOf("</select>"));
    for (const [value, label] of [
      ["blocked", "Blocked"],
      ["in_progress", "In progress"],
      ["todo", "To do"],
      ["cancelled", "Cancelled"],
    ])
      expect(select).toContain(`<option value="${value}">${label}</option>`);
    expect(html).toMatch(/<input id="task-reason" name="reason" maxlength="200"/);
    const version = html.match(/name="expected_version" value="(\d+)"/)?.[1] ?? "";
    await post(team.lea.cookie, `/console/tasks/${ids.blocked}`, {
      expected_version: version,
      status: "blocked",
      reason: "Waiting for the credentials of the new host",
    });
    const after = main(await page(`/console/tasks/${ids.blocked}`, team.lea.cookie));
    expect(after).toContain('<p class="banner-body">Waiting for the credentials of the new host</p>');
    expect(after).toContain("blocked because: Waiting for the credentials of the new host");
  });
});
