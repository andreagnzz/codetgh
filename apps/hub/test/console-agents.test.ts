import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
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
    expect(webapp).toContain("rewake");
    expect(webapp).toContain("2.1.14");
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
    expect(filtered).toContain('href="/console/agents?project="');
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

  it("is in French", async () => {
    const html = await page("/console/agents", team.sam.cookie, "fr");
    expect(html).toContain("Tes sessions sur ce hub, par projet.");
    expect(html).toContain("Non transmis");
    expect(await page("/console/agents", team.malik.cookie, "fr")).toContain(">En pause</span>");
  });
});
