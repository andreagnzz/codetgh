import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

// A team where everyone accepted their invitation and nobody has started an agent or sent a message yet.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const get = async (path: string, cookie: string, lang = "en-US,en;q=0.9") =>
  (await fetch(`${hub.url}${path}`, { headers: { cookie, "accept-language": lang } })).text();

describe("console empty states say what to do", () => {
  it("dashboard, for an admin and for a member", async () => {
    const admin = await get("/console", team.lea.cookie);
    expect(admin).toContain("No agent connected. Copy the invitation command to add one.");
    expect(admin).toContain('<code translate="no">codetgh invite &lt;email&gt;</code>');
    expect(admin).toContain("No messages yet. When agents talk, each message appears here as a line between them.");
    expect(admin).toContain("Nothing needs you right now.");
    const member = await get("/console", team.sam.cookie);
    expect(member).toContain("No agent connected yet. Set up CodeTgh, then start it in the team&#39;s repository.");
    expect(member).toContain('<code translate="no">codetgh setup</code>');
    expect(member).toContain('<code translate="no">codetgh start</code>');
  });

  it("threads, agents, alerts and invitations", async () => {
    const threads = await get("/console/threads", team.lea.cookie);
    expect(threads).toContain('<p class="empty-title">No threads yet.</p>');
    expect(threads).toContain("A thread starts with the first message");
    expect(await get("/console/agents", team.lea.cookie)).toContain("Sessions appear here once someone sets up CodeTgh");
    const alerts = await get("/console/alerts", team.lea.cookie);
    expect(alerts).toContain('<p class="empty-title">No alerts.</p>');
    expect(alerts).toContain("Messages that look like instructions");
    expect(await get("/console/members", team.lea.cookie)).toContain("No pending invitations.");
  });

  it("in French when the browser asks for it", async () => {
    const page = await get("/console", team.lea.cookie, "fr-FR,fr;q=0.9,en;q=0.8");
    expect(page).toContain('<html lang="fr">');
    expect(page).toContain("Aucun agent connecté. Copie la commande d&#39;invitation pour en ajouter un");
    expect(page).toContain("Vue d&#39;ensemble");
    expect(await get("/login", "", "fr")).toContain("<h1>Se connecter</h1>");
    expect(await get("/console/alerts", team.lea.cookie, "fr")).toContain("Aucune alerte.");
  });
});

describe("console errors say what happened and how to fix it", () => {
  it("returns the reason for a refused action, which the page shows next to the form", async () => {
    const bad = await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "not-an-email", role: "member" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("This email address isn&#39;t valid. Enter the address to invite, like name@example.com.");
    const erase = await consolePost(hub.url, team.sam.cookie, "/console/me/erase", { confirm: "nope" });
    expect(erase.status).toBe(400);
    expect(await erase.text()).toContain("Nothing was erased. Type erase in the box to confirm.");
  });

  it("refuses a form without its CSRF token, with a message", async () => {
    const res = await fetch(`${hub.url}/console/members/invite`, {
      method: "POST",
      headers: { cookie: team.lea.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.c",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("CSRF token missing or invalid");
  });
});
