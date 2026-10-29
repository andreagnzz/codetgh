import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resumeKillSwitch, setKillSwitch } from "../src/domain/admin.js";
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
    expect(await (await get("/console/threads/thr_unknown", { cookie: team.lea.cookie })).text()).toContain("thread not found");
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
