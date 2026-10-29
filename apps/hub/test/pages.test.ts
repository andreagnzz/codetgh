import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resumeKillSwitch, setKillSwitch } from "../src/domain/admin.js";
import { createInvitation } from "../src/domain/teams.js";
import { principalForToken } from "../src/principal.js";
import { type Hub, setRole, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${hub.url}${path}`, { headers, redirect: "manual" });

describe("pages", () => {
  it("starts every page with a doctype, so no browser renders it in quirks mode", async () => {
    for (const [path, cookie] of [
      ["/login", ""],
      ["/consent?client_id=c&scope=openid", ""],
      ["/invite/not-a-token", ""],
      ["/console", team.lea.cookie],
      ["/console/agents", team.lea.cookie],
    ]) {
      const html = await (await get(path ?? "", { cookie: cookie ?? "" })).text();
      expect(html.startsWith("<!doctype html>"), path).toBe(true);
    }
  });

  it("shows a full-page error in the public layout, with its status, the hub's reason and a way back", async () => {
    for (const [path, cookie, status, title] of [
      ["/console/threads/thr_unknown", team.lea.cookie, 404, "This page doesn't exist."],
      ["/console/tasks/tsk_unknown", team.lea.cookie, 404, "This page doesn't exist."],
      ["/console/members", team.sam.cookie, 403, "You can't open this page."],
      ["/console/memory?status=bogus", team.lea.cookie, 400, "This request isn't valid."],
    ] as const) {
      const res = await get(path, { cookie });
      expect(res.status, path).toBe(status);
      const html = await res.text();
      expect(html.startsWith("<!doctype html>"), path).toBe(true);
      expect(html, path).toContain('<main class="public">');
      expect(html, path).toContain('src="/brand/lockup-stacked-color.svg"');
      expect(html, path).toContain(`<h1>${title.replace("'", "&#39;")}</h1>`);
      expect(html, path).toContain('href="/console"');
    }
    // The hub's reason reads as a sentence in body text, not as a muted caption.
    expect(await (await get("/console/threads/thr_unknown", { cookie: team.lea.cookie })).text()).toContain(
      "<p>The hub said: thread not found.</p>",
    );
  });

  it("answers an unknown page opened in a browser with the 404 page, and an API, MCP or htmx client with the bare 404", async () => {
    const html = { accept: "text/html,application/xhtml+xml", cookie: team.lea.cookie };
    for (const path of ["/console/nope", "/nope"]) {
      const res = await get(path, html);
      expect(res.status, path).toBe(404);
      const page = await res.text();
      expect(page.startsWith("<!doctype html>"), path).toBe(true);
      expect(page, path).toContain('<main class="public">');
      expect(page, path).toContain("<h1>This page doesn&#39;t exist.</h1>");
      expect(res.headers.get("content-security-policy"), path).toContain("default-src 'self'");
    }
    expect(await (await get("/console/nope", { ...html, "accept-language": "fr" })).text()).toContain("Cette page n&#39;existe pas.");
    for (const [path, headers] of [
      ["/v1/nope", { ...html, authorization: `Bearer ${team.lea.token}` }],
      ["/mcp/nope", html],
      ["/console/nope", { ...html, "HX-Request": "true" }],
      ["/console/nope", { cookie: team.lea.cookie }],
    ] as const) {
      const res = await get(path, headers);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe("404 Not Found");
    }
  });

  it("tells someone an invitation refuses what happened and where to go, in their language", async () => {
    const { token } = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "nina@acme.test",
      role: "member",
      invitedBy: team.lea.userId,
      via: "console",
    });
    const headers = { cookie: team.sam.cookie, "accept-language": "fr" };
    const invite = await (await get(`/invite/${token}`, headers)).text();
    const csrf = invite.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
    const res = await fetch(`${hub.url}/invite/${token}/join`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      body: `csrf=${encodeURIComponent(csrf)}`,
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("<h1>Tu ne peux pas rejoindre l&#39;équipe avec cette invitation.</h1>");
    expect(html).toContain("<p>Réponse du hub\u00a0: Cette invitation est pour une autre adresse de courriel.</p>");
    expect(html).toContain('<a href="/login">Se connecter avec un autre compte</a>');
    expect(html).not.toContain("Ton rôle ne le permet pas");
  });

  it("writes the error page in French for a French reader", async () => {
    const html = await (await get("/console/members", { cookie: team.sam.cookie, "accept-language": "fr-FR" })).text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Tu ne peux pas ouvrir cette page.");
    expect(html).toContain("Demande à un admin de ton équipe");
    expect(html).toContain("réservé aux admins");
    expect(html).toContain("Retour à la vue d&#39;ensemble");
  });

  it("keeps the bare reason for an htmx request, which console.js shows under the form", async () => {
    const res = await get("/console/threads/thr_unknown", { cookie: team.lea.cookie, "HX-Request": "true" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain("<!doctype html>");
    expect(html).toContain("thread not found");
  });

  it("serves the component catalogue in development and tests, and never in production", async () => {
    expect((await get("/console/catalogue", { cookie: team.lea.cookie })).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    const prod = await startHub();
    try {
      const people = await prod.seed();
      const res = await fetch(`${prod.url}/console/catalogue`, { headers: { cookie: people.lea.cookie }, redirect: "manual" });
      expect(res.status).toBe(404);
      expect((await fetch(`${prod.url}/console`, { headers: { cookie: people.lea.cookie } })).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      await prod.stop();
    }
  });
});

describe("shell", () => {
  const html = async (cookie: string, path = "/console", lang = "en") => (await get(path, { cookie, "accept-language": lang })).text();

  it("puts the skip link first, the navigation in three groups and the current page marked", async () => {
    const page = await html(team.lea.cookie, "/console/agents");
    expect(page.indexOf('class="skip"')).toBeLessThan(page.indexOf("<aside"));
    const nav = page.slice(page.indexOf('<nav class="nav"'), page.indexOf("</nav>"));
    expect(nav.match(/<ul>/g)).toHaveLength(3);
    for (const label of [
      "Overview",
      "Threads",
      "Alerts",
      "Agents",
      "Projects",
      "Tasks",
      "Claims",
      "Memory",
      "Delegations",
      "Members",
      "Audit",
      "Settings",
    ])
      expect(nav).toContain(`>${label}</a>`);
    expect(nav).toContain('<a href="/console/agents" aria-current="page">Agents</a>');
    expect(page).toContain("<h1>Agents</h1>");
  });

  it("keeps My data, Tokens and the language in the account menu, and the same links in the small-screen menu", async () => {
    const page = await html(team.lea.cookie);
    const account = page.slice(page.indexOf('<details class="account">'), page.indexOf('<details class="menu">'));
    expect(account).toContain("Léa · owner");
    expect(account).toContain('href="/console/me"');
    expect(account).toContain('href="/console/tokens"');
    expect(account).toContain('href="/lang/fr?next=%2Fconsole"');
    const menu = page.slice(page.indexOf('<details class="menu">'), page.indexOf("</header>"));
    expect(menu).toContain("Menu");
    expect(menu).toContain('<nav class="nav" aria-label="Console">');
    expect(menu).toContain('href="/console/me"');
  });

  it("shows the project filter as a menu that names the current choice, with the same links", async () => {
    const page = await html(team.lea.cookie, "/console/threads?project=none");
    const filter = page.slice(
      page.indexOf('<details class="projects-filter">'),
      page.indexOf("</details>", page.indexOf("projects-filter")),
    );
    expect(filter).toMatch(/<summary>Project: <strong>Outside a project<\/strong><svg/);
    expect(filter).toContain('<nav aria-label="Project">');
    expect(filter).toContain('<a href="/console/threads?project=">All projects</a>');
    expect(filter).toContain('<a href="/console/threads?project=none" aria-current="page">Outside a project</a>');
  });

  it("shows a guest no link to a page that would refuse them", async () => {
    await setRole(hub, team.malik.userId, "guest");
    try {
      const page = await html(team.malik.cookie);
      for (const path of ["/console/projects", "/console/tasks", "/console/members", "/console/alerts", "/console/tokens"])
        expect(page).not.toContain(`href="${path}"`);
      expect(page).toContain('href="/console/threads"');
      expect(page).toContain('href="/console/me"');
    } finally {
      await setRole(hub, team.malik.userId, "member");
    }
  });

  it("names the live state, holds the toast region and the confirmation dialog, in French for a French reader", async () => {
    const page = await html(team.lea.cookie, "/console", "fr");
    expect(page).toContain(
      '<p class="live" role="status" data-state="connecting" data-live="En direct" data-lost="Reconnexion…">Connexion…</p>',
    );
    expect(page).toContain('<div class="toasts" role="status"></div>');
    expect(page).toContain('<dialog id="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body">');
    expect(page).toContain(">Annuler</button>");
    expect(page).toContain(">Vue d&#39;ensemble</a>");
  });

  it("says on every page that agent traffic is stopped, with the way to resume it for an admin", async () => {
    const lea = await principalForToken(hub.db, team.lea.token);
    if (!lea) throw new Error("setup");
    await setKillSwitch(hub.db, lea, "rotating keys");
    try {
      const admin = await html(team.lea.cookie, "/console/threads");
      expect(admin).toMatch(/<div class="banner" data-tone="danger" role="alert">.*Agent traffic stopped/s);
      expect(admin).toContain('<a href="/console">Resume agent traffic</a>');
      const member = await html(team.sam.cookie, "/console/threads");
      expect(member).toContain("Agent traffic stopped");
      expect(member).not.toContain("Resume agent traffic");
    } finally {
      await resumeKillSwitch(hub.db, lea, "yes");
    }
  });
});
