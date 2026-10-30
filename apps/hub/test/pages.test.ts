import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { task } from "../src/db/schema.js";
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
    // What to do is the body text; the hub's own reason follows as a muted caption.
    expect(await (await get("/console/tasks/tsk_unknown", { cookie: team.lea.cookie })).text()).toContain(
      '<p>Check the link, or start again from the overview.</p><p class="meta">The hub said: task not found.</p>',
    );
    // An unknown thread has its own page: what to do, and the way back to the threads list.
    const thread = await (await get("/console/threads/thr_unknown", { cookie: team.lea.cookie })).text();
    expect(thread).toContain("<h1>This thread doesn&#39;t exist.</h1><p>Check the link, or find the thread in the list.</p>");
    expect(thread).toContain('href="/console/threads"');
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
    // The page of an invitation for another address has no Join: the session's CSRF token comes from one for Sam's own.
    const own = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: team.sam.email,
      role: "member",
      invitedBy: null,
      via: "system",
    });
    const invite = await (await get(`/invite/${own.token}`, headers)).text();
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
    expect(html).toContain('<p class="meta">Réponse du hub\u00a0: Cette invitation est pour une autre adresse de courriel.</p>');
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

  it("shows a task's title as written, never looked up in the translations", async () => {
    const [created] = await hub.db
      .insert(task)
      .values({ id: "tsk_01NAMEDTITLE000000000000000", teamId: team.teamId, title: "Overview", createdByUser: team.lea.userId })
      .returning();
    const html = await (await get(`/console/tasks/${created?.id}`, { cookie: team.lea.cookie, "accept-language": "fr" })).text();
    expect(html).toContain("<h1>Overview</h1>");
    expect(html).toContain("<title>Overview · CodeTgh</title>");
  });

  it("keeps the bare reason for an htmx request, which console.js shows under the form", async () => {
    const res = await get("/console/threads/thr_unknown", { cookie: team.lea.cookie, "HX-Request": "true" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain("<!doctype html>");
    expect(html).toContain("thread not found");
    // In the page's language, as the error page gives it.
    const fr = await get("/console/members", { cookie: team.sam.cookie, "HX-Request": "true", "accept-language": "fr" });
    expect(fr.status).toBe(403);
    expect(await fr.text()).toContain("réservé aux admins");
  });

  it("serves the component catalogue only on a hub the test harness starts, never from the hub's own configuration", async () => {
    expect((await get("/console/catalogue", { cookie: team.lea.cookie })).status).toBe(200);
    // Opt-in: no environment variable, NODE_ENV included, turns it on for a hub started by main.ts.
    expect(loadConfig({ CODETGH_SECRET: "s", NODE_ENV: "development" }).catalogue).toBeUndefined();
    const plain = await startHub({ config: { catalogue: undefined } });
    try {
      const people = await plain.seed();
      const res = await fetch(`${plain.url}/console/catalogue`, { headers: { cookie: people.lea.cookie }, redirect: "manual" });
      expect(res.status).toBe(404);
      expect((await fetch(`${plain.url}/console`, { headers: { cookie: people.lea.cookie } })).status).toBe(200);
    } finally {
      await plain.stop();
    }
  });
});

describe("public pages", () => {
  const html = async (path: string, lang = "en", cookie = "") => (await get(path, { "accept-language": lang, cookie })).text();

  it("sign-in: one primary button, and the hub's answer under the fields that point at it, in the reader's words", async () => {
    const page = await html("/login");
    expect(page).toContain("<h1>Sign in</h1>");
    expect(page.match(/class="primary"/g)).toHaveLength(1);
    expect(page).toContain('<button type="submit" class="primary">Sign in</button>');
    expect(page).toMatch(/<input name="email"[^>]*aria-describedby="error"/);
    expect(page).toMatch(/<input name="password"[^>]*aria-describedby="error"/);
    const answer = page.indexOf('id="error"');
    expect(answer).toBeGreaterThan(page.indexOf('name="password"'));
    expect(answer).toBeLessThan(page.indexOf(">Sign in</button>"));
    expect(await html("/login", "fr")).toContain("Le courriel ou le mot de passe est incorrect. Vérifie les deux, puis réessaie.");
    expect(await html("/login", "fr")).toContain("Trop d&#39;essais. Attends quelques secondes, puis réessaie.");
  });

  it("consent: the access asked for in words next to each scope, an unknown scope said as such, and the way back", async () => {
    const page = await html(
      `/consent?client_id=${encodeURIComponent("https://client.example/meta.json")}&scope=codetgh+email+calendar.read&redirect_uri=${encodeURIComponent("https://client.example/cb")}`,
    );
    expect(page).toContain("<h1>Allow access to your account?</h1>");
    expect(page).toContain('<code translate="no">https://client.example/meta.json</code>');
    expect(page).toContain('<li><span>See your email address</span> <code translate="no">email</code></li>');
    expect(page).toContain('<li><span>Not described by this hub</span> <code translate="no">calendar.read</code></li>');
    expect(page).toContain('<code translate="no">client.example</code>');
    expect(page).toContain('<button type="button" class="primary" data-consent="accept">Allow</button>');
    expect(page).toContain('<button type="button" class="secondary" data-consent="deny">Deny</button>');
    // A scope named like an object's own property is not described by accident.
    expect(await html("/consent?client_id=c&scope=constructor")).toContain("<span>Not described by this hub</span>");
  });

  it("invitation: the invited address is the new account's sign-in, read-only; signed in, the account it joins with", async () => {
    const { token } = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "ines@acme.test",
      role: "guest",
      invitedBy: team.lea.userId,
      via: "console",
    });
    const page = await html(`/invite/${token}`);
    expect(page).toContain("<title>Join Acme web · CodeTgh</title>");
    expect(page).toContain("<h1>Join Acme web</h1>");
    // A link that no longer works names no team, in the tab title either.
    expect(await html("/invite/not-a-token", "fr")).toContain("<title>Cette invitation n&#39;est plus valable. · CodeTgh</title>");
    expect(page).toContain("You&#39;re invited as a guest. A guest sees only the threads they take part in.");
    // Read whole as text, however long; the sign-up script and password managers read it from a field kept out of sight.
    expect(page).toContain('<p class="value" translate="no">ines@acme.test</p>');
    const field = page.match(/<input name="email"[^>]*>/)?.[0] ?? "";
    for (const attr of ['type="email"', 'value="ines@acme.test"', 'autocomplete="username"', 'hidden=""']) expect(field).toContain(attr);
    expect(page).toContain('<p class="help" id="invite-password-help">At least 12 characters.</p>');
    // Signed in with another address: no Join the hub is sure to refuse; the page says why, and the way on is another account.
    const other = await html(`/invite/${token}`, "fr", team.sam.cookie);
    expect(other).toMatch(
      /<div class="banner" data-tone="warn" role="status">.*Cette invitation est pour une autre adresse de courriel\./s,
    );
    expect(other).toContain("Elle a été envoyée à ines@acme.test. Compte connecté : sam@acme.test.");
    expect(other).toContain('<a class="button primary" href="/login">Se connecter avec un autre compte</a>');
    expect(other).not.toContain('id="invite-join"');
    // Signed in with the invited address: the account it joins with, and Join as the one primary button.
    const own = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "SAM@acme.test",
      role: "member",
      invitedBy: team.lea.userId,
      via: "console",
    });
    const mine = await html(`/invite/${own.token}`, "fr", team.sam.cookie);
    expect(mine).toContain("<dd>sam@acme.test</dd>");
    expect(mine).toContain('<button type="submit" class="primary">Rejoindre Acme web</button>');
    expect(mine.match(/class="(button )?primary"/g)).toHaveLength(1);
    expect(mine).not.toContain('class="banner"');
  });

  it("device: the description under the title, and a polite live region the check panel and its answers land in", async () => {
    const page = await html("/console/device", "en", team.lea.cookie);
    expect(page).toContain(
      '<div class="page-meta"><p class="lede">When codetgh signs in a terminal, it shows a code. Type that code here, then approve the terminal.</p></div>',
    );
    expect(page).toContain('<div id="device" aria-live="polite"></div>');
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
    // Hidden until console.js follows the stream, and a live region only once it is open: no "Connecting" left on screen
    // without the script, and no announcement on every page load.
    expect(page).toContain(
      '<p class="live" hidden="" data-state="connecting" data-live="En direct" data-lost="Reconnexion…" data-offline="Hors ligne depuis {time}">Connexion…</p>',
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
      // The same words as the confirmation that stopped it: claims are refused too.
      expect(admin).toContain("Agents can&#39;t send messages or claim files until an admin resumes agent traffic.");
      // Straight to the form, which sits below the line and the presence on a phone.
      expect(admin).toContain('<a href="/console#agent-traffic">Resume agent traffic</a>');
      expect(await html(team.lea.cookie)).toContain('id="agent-traffic"');
      const member = await html(team.sam.cookie, "/console/threads");
      expect(member).toContain("Agent traffic stopped");
      expect(member).not.toContain("Resume agent traffic");
    } finally {
      await resumeKillSwitch(hub.db, lea, "yes");
    }
  });
});
