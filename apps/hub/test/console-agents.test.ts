import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost, csrfToken } from "../../../e2e/helpers.js";
import { session as authSession } from "../src/db/auth-schema.js";
import { agent, project } from "../src/db/schema.js";
import { RateLimiter } from "../src/domain/limits.js";
import { type Hub, startHub } from "./harness.js";

// Agents, Projects and Delegations: who is connected where, in words, and the actions on a session named after it.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
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
  return res.status === 204 ? null : res.json();
};
const session = async (token: string, id: string, body: Record<string, unknown>) =>
  ((await rest(token, "/v1/agents/session", { session_id: id, ...body })) as { agent_id: string }).agent_id;
const repo = (name: string) => ({ repo_fingerprint: repoFingerprint(`git@github.com:acme/${name}.git`), repo_name: `acme/${name}` });
const page = async (path: string, cookie: string, lang = "en") =>
  (await fetch(`${hub.url}${path}`, { headers: { cookie, "accept-language": lang } })).text();
const main = (html: string) => html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
// The part of a page under a heading: from its id to the end of its section.
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
// A project's head on Projects: what its "…" holds, and what shows without opening it.
const head = (part: string) => {
  const below = [part.indexOf('<ul class="session-list">'), part.indexOf('<p class="empty">')].filter((i) => i >= 0);
  const top = part.slice(part.indexOf("</h2>"), Math.min(...below));
  const menu = top.slice(top.indexOf('<details class="row-menu">'), top.indexOf("</details>") + "</details>".length);
  return { menu, outside: top.replace(menu, "") };
};

beforeAll(async () => {
  // The writes below come faster than people write: a clock that moves an hour per call keeps the quotas out of the way.
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  projects = Object.fromEntries((await hub.db.select().from(project)).map((pr) => [pr.name, pr.id]));
  ids.sam = await session(team.sam.token, "sam-web", {
    ...repo("webapp"),
    branch: "feat/login",
    push_mode: "rewake",
    permission_mode: "acceptEdits",
    client_version: "2.1.14",
  });
  ids.samApi = await session(team.sam.token, "sam-api", { ...repo("api"), branch: "fix/limits", permission_mode: "bypassPermissions" });
  ids.malik = await session(team.malik.token, "malik-billing", { ...repo("billing"), branch: "fix/invoice", client_version: "2.1.9" });
  ids.lea = await session(team.lea.token, "lea-loose", { branch: "scratch" });
  ids.leaGone = await session(team.lea.token, "lea-gone", { ...repo("webapp"), branch: "main" });
  ids.delegate = await session(team.malik.token, "malik-delegate", {
    ...repo("api"),
    branch: "main",
    accept_requests_from: ["@sam", "@lea"],
  });
  await rest(team.lea.token, "/v1/agents/session/end", { session_id: "lea-gone" });
  // Sam's API session was seen five minutes ago: idle. Malik paused his agents (codetgh pause).
  await hub.db
    .update(agent)
    .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
    .where(eq(agent.id, ids.samApi));
  await rest(team.malik.token, "/v1/me/pause", {});
  const a2a = await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "Partner bot" });
  ids.a2aPage = await a2a.text();
});
afterAll(() => hub.stop());

describe("agents", () => {
  it("lists the sessions by project: the person, the session's label and its short id, the state in words", async () => {
    const html = main(await page("/console/agents", team.lea.cookie));
    const webapp = section(html, `p-${projects["acme/webapp"]}`);
    expect(webapp).toContain(">Sam</span>");
    expect(webapp).toContain(">sam@feat/login</span>");
    expect(webapp).toContain(short(ids.sam ?? ""));
    expect(webapp).toContain("Online");
    // An ended session: offline, and when it was last seen.
    expect(webapp).toContain("Offline");
    expect(webapp).toMatch(/Last seen <time/);
    // Idle and paused are pills; trusted and the kind of a Claude Code session are never shown.
    expect(section(html, `p-${projects["acme/api"]}`)).toContain('<span class="pill" data-tone="neutral">Idle</span>');
    expect(section(html, `p-${projects["acme/billing"]}`)).toContain('<span class="pill" data-tone="warn">Paused</span>');
    expect(html).not.toContain("trusted");
    expect(html).not.toContain("claude-code");
    expect(section(html, "p-none")).toContain(">lea@scratch</span>");
  });

  it("names the permission mode, and says when a session prompts for nothing or reported nothing", async () => {
    const html = main(await page("/console/agents", team.lea.cookie));
    expect(html).toContain(">Permissions</th>");
    expect(html).toContain(">Push</th>");
    expect(html).toContain(">Claude Code</th>");
    const api = section(html, `p-${projects["acme/api"]}`);
    expect(api).toContain('<span class="pill" data-tone="warn">Prompts off</span>');
    expect(api).toContain("bypassPermissions");
    const webapp = section(html, `p-${projects["acme/webapp"]}`);
    expect(webapp).toContain("acceptEdits");
    // A push mode in words, with CodeTgh's own name for it under them.
    expect(webapp).toContain('<span>Wakes up</span><span class="machine meta">rewake</span>');
    expect(webapp).toContain('<span class="machine">2.1.14</span>');
    expect(section(html, `p-${projects["acme/billing"]}`)).toContain("Not reported");
  });

  it("asks before quarantining or removing a session, in buttons named after it", async () => {
    const webapp = section(main(await page("/console/agents", team.lea.cookie)), `p-${projects["acme/webapp"]}`);
    const button = (action: string) =>
      webapp.match(new RegExp(`<button[^>]*hx-post="/console/agents/${ids.sam}/${action}"[^>]*>`))?.[0] ?? "";
    const quarantine = button("quarantined");
    expect(quarantine).toContain('class="danger"');
    expect(quarantine).toContain('aria-label="Quarantine sam@feat/login…"');
    expect(quarantine).toContain('data-confirm="Quarantine Sam?"');
    expect(quarantine).toContain('data-confirm-body="All of their sessions can then send only notes, questions and answers');
    expect(quarantine).toContain('data-confirm-action="Quarantine"');
    const remove = button("remove");
    expect(remove).toContain('aria-label="Remove sam@feat/login…"');
    expect(remove).toContain('data-confirm="Remove sam@feat/login?"');
    expect(remove).toContain('data-done="sam@feat/login removed."');
  });

  it("shows a quarantine as a pill, and lets only an admin lift it, at once", async () => {
    expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${ids.sam}/quarantined`)).status).toBe(204);
    const admin = section(main(await page("/console/agents", team.lea.cookie)), `p-${projects["acme/webapp"]}`);
    expect(admin).toContain('<span class="pill" data-tone="danger">Quarantined</span>');
    const lift = admin.match(/<button[^>]*hx-post="\/console\/agents\/[^"]+\/trusted"[^>]*>/)?.[0] ?? "";
    expect(lift).toContain('aria-label="Lift quarantine sam@feat/login"');
    expect(lift).not.toContain("data-confirm");
    const own = main(await page("/console/agents", team.sam.cookie));
    expect(own).toContain("Quarantined");
    expect(own).not.toContain("Lift quarantine");
    expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${ids.sam}/trusted`)).status).toBe(204);
  });

  it("keeps external agents apart, and lets an admin add one from the page header", async () => {
    const html = await page("/console/agents", team.lea.cookie);
    const head = html.slice(html.indexOf('<div class="page-head">'), html.indexOf("</main>"));
    expect(head).toContain("Every session connected to the team, by project.");
    expect(head).toMatch(/<summary>Add an external agent<\/summary>/);
    expect(head).toContain('hx-post="/console/agents/a2a" hx-target="#a2a-result"');
    expect(head).toContain('name="name"');
    expect(head).toContain('<div id="a2a-result"></div>');
    const external = section(main(html), "external-h");
    expect(external).toContain("External agents");
    expect(external).toContain("Partner bot");
    expect(external).toContain('<span class="pill" data-tone="neutral">External</span>');
    expect(external).toContain('data-confirm="Remove the external agent Partner bot?"');
    expect(section(main(html), "p-none")).not.toContain("Partner bot");
    // What an external agent may do is said once, in the form that adds one.
    expect(html.split("An external agent can ask the team questions").length).toBe(2);
    // A member sees their own sessions, and nothing to add.
    const member = await page("/console/agents", team.sam.cookie);
    expect(member).toContain("Your sessions on this hub, by project.");
    expect(member).not.toContain("Add an external agent");
  });

  it("shows a new external agent's token once, to copy, with what the team will see", () => {
    expect(ids.a2aPage).toContain("Copy the token now.");
    expect(ids.a2aPage).toMatch(/<code translate="no">Agent Card: http[^\n]+\nAuthorization: Bearer ctgh_/);
    expect(ids.a2aPage).toContain('aria-label="Copy the two lines"');
    expect(ids.a2aPage).toMatch(
      /It appears to the team as <span class="chip" translate="no" title="@a2a-[0-9a-f]{8}">@a2a-[0-9a-f]{8}<\/span>\./,
    );
  });

  it("says what fills an empty page, and how to see every project again", async () => {
    const filtered = main(await page(`/console/agents?project=${projects["acme/latency"]}`, team.lea.cookie));
    expect(filtered).toContain("No sessions in acme/latency.");
    // The same action, and the same name, as on Threads.
    expect(filtered).toContain('<a class="agents-all" href="/console/agents?project=">Show all projects</a>');
    const fresh = await startHub();
    try {
      const other = await fresh.seed();
      const empty = main(await (await fetch(`${fresh.url}/console/agents`, { headers: { cookie: other.lea.cookie } })).text());
      expect(empty).toContain("No sessions yet.");
      expect(empty).toContain('<code translate="no">codetgh setup</code>');
      expect(empty).toContain('<code translate="no">codetgh start</code>');
      expect(empty).toContain('aria-label="Copy codetgh setup"');
    } finally {
      await fresh.stop();
    }
  });

  it("answers a refused action with what happened and what to do next, in the page's language", async () => {
    // As console.js sends it: htmx shows the bare reason where the action was.
    const refused = async (path: string, cookie: string, lang = "en") => {
      const res = await fetch(`${hub.url}${path}`, {
        method: "POST",
        headers: {
          cookie,
          "X-CSRF-Token": await csrfToken(hub.url, cookie),
          "HX-Request": "true",
          "accept-language": lang,
          "content-type": "application/x-www-form-urlencoded",
          origin: hub.url,
        },
        body: path.endsWith("/project") ? "project_id=prj_gone" : "",
      });
      return { status: res.status, text: await res.text() };
    };
    const gone = "This agent is no longer on the hub. Reload the page to see the current list.";
    expect(await refused("/console/agents/agt_gone/quarantined", team.lea.cookie)).toEqual({
      status: 404,
      text: expect.stringContaining(gone),
    });
    expect((await refused("/console/agents/agt_gone/remove", team.lea.cookie)).text).toContain(gone);
    expect((await refused("/console/agents/agt_gone/remove", team.lea.cookie, "fr")).text).toContain(
      "Cet agent n&#39;est plus sur le hub. Recharge la page pour voir la liste à jour.",
    );
    expect((await refused(`/console/agents/${ids.lea}/project`, team.lea.cookie)).text).toContain(
      "This project is no longer on the hub. Reload the page to see the current list.",
    );
    expect((await refused("/console/projects/prj_gone/launch", team.lea.cookie)).text).toContain("This project is no longer on the hub.");
    expect((await refused("/console/projects/prj_gone/runner", team.lea.cookie, "fr")).text).toContain(
      "Ce projet n&#39;est plus sur le hub.",
    );
    expect((await refused("/console/delegations/agt_gone/stop", team.lea.cookie)).text).toContain(
      "This session no longer takes requests. Reload the page to see the current list.",
    );
    // A sign-in older than 10 minutes: how to get a fresh one.
    await hub.db
      .update(authSession)
      .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(authSession.userId, team.malik.userId));
    const stale = await refused("/console/agents/a2a", team.malik.cookie);
    expect(stale.status).toBe(403);
    expect(stale.text).toContain(
      "Adding an external agent needs a sign-in from the last 10\u00a0minutes. Sign in again at /login, then add it.",
    );
    expect((await refused("/console/agents/a2a", team.malik.cookie, "fr")).text).toContain("Reconnecte-toi sur /login");
    await hub.db.update(authSession).set({ createdAt: new Date() }).where(eq(authSession.userId, team.malik.userId));
  });

  it("is in French", async () => {
    const html = await page("/console/agents", team.sam.cookie, "fr");
    expect(html).toContain("Tes sessions sur ce hub, par projet.");
    expect(html).toContain(">Réception</th>");
    expect(html).toContain("<span>Se réveille</span>");
    expect(html).toContain("Non transmis");
    expect(await page("/console/agents", team.malik.cookie, "fr")).toContain(">En pause</span>");
    // Words that describe a session agree with it, as a feminine noun.
    expect(html).toMatch(/<p class="meta">Vue <time/);
  });
});

describe("projects", () => {
  it("shows the owner each project's Remote Control and runner as a state in words, then the action", async () => {
    for (const name of ["acme/webapp", "acme/api", "acme/ops"])
      expect((await consolePost(hub.url, team.lea.cookie, `/console/projects/${projects[name]}/launch`, { on: "1" })).status).toBe(204);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/projects/${projects["acme/billing"]}/runner`, { on: "1" })).status).toBe(
      204,
    );
    await rest(team.lea.token, "/v1/launcher/report", { project_id: projects["acme/webapp"], running: true });
    await rest(team.lea.token, "/v1/launcher/report", {
      project_id: projects["acme/api"],
      running: false,
      error: "claude: command not found",
    });
    await rest(team.lea.token, "/v1/runner/report", { project_id: projects["acme/billing"], running: 1 });
    const html = main(await page("/console/projects", team.lea.cookie));
    const webapp = section(html, `p-${projects["acme/webapp"]}`);
    expect(webapp).toContain('<span class="pill" data-tone="ok">Remote Control running</span>');
    expect(webapp).toContain(">Stop Remote Control</button>");
    expect(webapp).toMatch(/href="https:\/\/claude\.ai\/code">Open claude\.ai\/code<svg[^>]*>.*M15 3h6v6/);
    // A failure says so in the pill, and the launcher's report under it.
    const api = section(html, `p-${projects["acme/api"]}`);
    expect(api).toContain('<span class="pill" data-tone="danger">Remote Control failed</span>');
    expect(api).toContain("<code>claude: command not found</code>");
    expect(section(html, `p-${projects["acme/ops"]}`)).toContain(
      '<span class="pill" data-tone="warn">Waiting for the launcher on your machine</span>',
    );
    expect(section(html, `p-${projects["acme/billing"]}`)).toContain(
      '<span class="pill" data-tone="ok">Runner on · 1\u00a0agent running</span>',
    );
    // Never switched on: stopped, in words; the way to start it and the project id wait behind the project's "…".
    const latency = section(html, `p-${projects["acme/latency"]}`);
    expect(latency).toContain('<span class="tool-state">Remote Control stopped</span>');
    expect(latency).toContain('<span class="tool-state">Runner stopped</span>');
    expect(latency).toContain("No session on this project right now.");
    const { menu, outside } = head(latency);
    expect(menu).toContain('<summary aria-label="Actions for acme/latency">');
    expect(menu).toContain('aria-label="Start Remote Control acme/latency"');
    expect(menu).toContain('aria-label="Start the runner acme/latency"');
    expect(menu).toContain(`<code>${projects["acme/latency"]}</code>`);
    expect(outside).not.toContain("<button");
    expect(outside).not.toContain(projects["acme/latency"]);
  });

  it("gives a project's head one direct action per tool that is on, named after the project", async () => {
    const html = main(await page("/console/projects", team.lea.cookie));
    const webapp = head(section(html, `p-${projects["acme/webapp"]}`));
    expect(webapp.outside).toMatch(/<button[^>]*aria-label="Stop Remote Control acme\/webapp"[^>]*>Stop Remote Control<\/button>/);
    expect(webapp.outside.match(/<button/g)).toHaveLength(1);
    expect(webapp.menu).toContain('aria-label="Start the runner acme/webapp"');
    expect(webapp.menu).not.toContain("Remote Control");
    // A failed launcher keeps its action at hand, with the report on the line under it.
    const api = head(section(html, `p-${projects["acme/api"]}`));
    expect(api.outside).toContain('aria-label="Stop Remote Control acme/api"');
  });

  it("lists each project's sessions for every member, what they said they do, and no owner tools", async () => {
    const html = main(await page("/console/projects", team.sam.cookie));
    const webapp = section(html, `p-${projects["acme/webapp"]}`);
    expect(webapp).toContain('<ul class="session-list">');
    expect(webapp).toContain(">sam@feat/login</span>");
    expect(webapp).toContain("Online");
    expect(html).not.toContain("Project id");
    expect(html).not.toContain("Start Remote Control");
  });

  it("lets a member attach a session outside a project, in words that say it happens at once", async () => {
    const html = main(await page("/console/projects", team.lea.cookie));
    const loose = section(html, "p-none");
    expect(loose).toContain(
      "Start <code>claude</code> inside the project&#39;s repository folder to link a session, or attach one to a project here.",
    );
    expect(loose).toContain(`hx-post="/console/agents/${ids.lea}/project"`);
    // Each control says which session it moves, and no project is chosen for the person.
    expect(loose).toContain('<select name="project_id" aria-label="Project for lea@scratch">');
    expect(loose).toMatch(/<option value="" disabled(="")? selected(="")?>Choose a project…<\/option>/);
    expect(loose).toContain(
      '<button type="submit" class="secondary" aria-label="Attach to project lea@scratch">Attach to project</button>',
    );
    const refused = await consolePost(hub.url, team.lea.cookie, `/console/agents/${ids.lea}/project`, {});
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("Choose a project for this session.");
    const french = section(main(await page("/console/projects", team.lea.cookie, "fr")), "p-none");
    expect(french).toContain("Lance <code>claude</code> dans le dossier du dépôt du projet");
    expect(french).toContain("Rattacher au projet");
    expect(french).toContain("Choisis un projet…");
  });

  it("offers to attach a session outside a project only to someone who can", async () => {
    // Léa's session is the only one outside a project: Sam reads how to link one, without an offer he cannot take.
    const loose = section(main(await page("/console/projects", team.sam.cookie)), "p-none");
    expect(loose).toContain(">lea@scratch</span>");
    expect(loose).not.toContain("<form");
    expect(loose).toContain("Start <code>claude</code> inside the project&#39;s repository folder to link a session.</p>");
    expect(loose).not.toContain("attach one");
  });

  it("says how a project appears when there is none", async () => {
    const fresh = await startHub();
    try {
      const other = await fresh.seed();
      await fresh.db.delete(project);
      const empty = main(await (await fetch(`${fresh.url}/console/projects`, { headers: { cookie: other.sam.cookie } })).text());
      expect(empty).toContain("No projects yet.");
      expect(empty).toContain("A project appears when a member starts a session with <code>codetgh start</code> in a team repository");
      expect(empty).toContain('<code translate="no">codetgh project new</code>');
    } finally {
      await fresh.stop();
    }
  });
});

describe("delegations", () => {
  it("names each delegate session, who may send it work, and asks before turning it off", async () => {
    const html = main(await page("/console/delegations", team.lea.cookie));
    expect(html).toContain(">malik@main</span>");
    expect(html).toContain("acme/api");
    expect(html).toContain('<span class="chip" translate="no" title="@lea">@lea</span>');
    expect(html).toContain('<span class="chip" translate="no" title="@sam">@sam</span>');
    expect(html).toContain('<span class="pill" data-tone="warn">Paused</span>');
    const off = html.match(/<button[^>]*hx-post="\/console\/delegations\/[^"]+\/stop"[^>]*>/)?.[0] ?? "";
    // Turning one off is hard to undo (unfinished requests expire): a danger action, named as its dialog asks.
    expect(off).toContain('class="danger"');
    expect(off).toContain('aria-label="Turn off delegation for malik@main…"');
    expect(off).toContain('data-confirm="Turn off delegation for malik@main?"');
    expect(off).toContain('data-done="Delegation of malik@main turned off."');
    // The dialog's prose names no option whose hyphens would break it across lines.
    expect(off).toContain("only a new codetgh start that names who may send it requests delegates it again.");
    expect(off).not.toContain("--accept-requests-from");
  });

  it("says how to start a delegate session when there is none", async () => {
    const html = main(await page("/console/delegations", team.sam.cookie));
    expect(html).toContain("No delegate sessions.");
    // The page's description says what one does; the empty state, how to start one.
    expect(html).toContain("Start one in the project&#39;s repository, with the handles of the teammates who may send it tasks:");
    expect(html).not.toContain("A delegate session does the tasks");
    expect(html).toContain('<code translate="no">codetgh start --accept-requests-from @&lt;handle&gt;</code>');
    expect(main(await page("/console/delegations", team.sam.cookie, "fr"))).toContain("Aucune session déléguée.");
  });
});
