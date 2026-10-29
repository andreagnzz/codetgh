import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { membership, personalToken, team as teamTable } from "../src/db/schema.js";
import { bridgeAuthor } from "../src/domain/bridges.js";
import { createInvitation } from "../src/domain/teams.js";
import { type Hub, startHub } from "./harness.js";

// Members, Tokens, My data and Settings: people in words, each action named after its row and asking first when it cuts
// something off, forms with their labels and help, and what is shown once in a block to copy.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const ids: Record<string, string> = {};

const page = async (path: string, cookie: string, lang = "en") =>
  (await fetch(`${hub.url}${path}`, { headers: { cookie, "accept-language": lang } })).text();
const main = (html: string) => html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
// The part of a page under a heading: from its id to the end of its section.
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
// The table row that holds a text.
const row = (html: string, text: string) => html.split("<tr").find((r) => r.includes(text)) ?? "";
const button = (html: string, post: string) => html.match(new RegExp(`<button[^>]*hx-post="${post}"[^>]*>`))?.[0] ?? "";

beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  for (const key of ["lea", "sam", "malik"] as const) {
    const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team[key].userId));
    ids[key] = m?.id ?? "";
  }
  await createInvitation(hub.db, {
    teamId: team.teamId,
    email: "ines@acme.test",
    role: "member",
    invitedBy: team.lea.userId,
    via: "console",
  });
  // An external agent and the GitHub bridge are members too: the hub keeps their handle and role.
  await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "Partner bot" });
  await bridgeAuthor(hub.db, team.teamId, "GitHub");
});
afterAll(() => hub.stop());

describe("members", () => {
  it("lists people by name with their email, the handle as typed, the role in words, and the reader marked", async () => {
    const html = main(await page("/console/members", team.lea.cookie));
    const people = section(html, "members-h");
    expect(people).toContain("Team members");
    const lea = row(people, "lea@acme.test");
    expect(lea).toContain(">Léa</span>");
    expect(lea).toContain(">You</span>");
    expect(lea).toContain(">@lea</span>");
    expect(lea).toContain(">Owner<");
    const sam = row(people, "sam@acme.test");
    expect(sam).toContain(">Member<");
    expect(sam).toMatch(/<time[^>]*>[^<]+<\/time>/);
    // A role is not a state: no pill.
    expect(people).not.toContain('class="pill"');
  });

  it("puts a person's actions behind a menu named after them, and asks before a role change or a revoke", async () => {
    const sam = row(section(main(await page("/console/members", team.lea.cookie)), "members-h"), "sam@acme.test");
    expect(sam).toContain('<summary aria-label="Actions for Sam">');
    // The handle is changed there, with its rule said before a refusal.
    expect(sam).toContain(`hx-post="/console/members/${ids.sam}/handle"`);
    expect(sam).toContain("Lowercase letters, digits and dashes.");
    const admin = sam.match(/<button[^>]*data-confirm="Make Sam an admin\?"[^>]*>/)?.[0] ?? "";
    expect(admin).toContain(`hx-post="/console/members/${ids.sam}/role"`);
    expect(admin).toContain('hx-vals="{&quot;role&quot;:&quot;admin&quot;}"');
    expect(admin).toContain('data-confirm-body="Admins manage members, alerts, the audit log and the team');
    expect(admin).toContain('data-confirm-action="Make admin"');
    expect(sam).toContain('data-confirm="Make Sam a guest?"');
    expect(sam).toContain('data-confirm="Make Sam an owner?"');
    const revoke = button(sam, `/console/members/${ids.sam}/revoke`);
    expect(revoke).toContain('class="danger"');
    expect(revoke).toContain('aria-label="Revoke access for Sam…"');
    expect(revoke).toContain('data-confirm="Revoke Sam&#39;s access?"');
    expect(revoke).toContain('data-confirm-body="They&#39;re signed out at once: their tokens stop working');
    expect(revoke).toContain('data-done="Sam&#39;s access revoked."');
  });

  it("offers no action the hub would refuse: on yourself, on an owner for an admin, on the bridge", async () => {
    const owner = section(main(await page("/console/members", team.lea.cookie)), "members-h");
    // Léa changes her own handle, never her own role or access.
    const lea = row(owner, "lea@acme.test");
    expect(lea).toContain(`hx-post="/console/members/${ids.lea}/handle"`);
    expect(lea).not.toContain("/role");
    expect(lea).not.toContain("/revoke");
    // The external agent can be cut off, but keeps its handle and role; the bridge keeps everything.
    const bot = row(owner, "Partner bot");
    expect(bot).toContain("External agent");
    expect(bot).toContain("/revoke");
    expect(bot).not.toContain("/handle");
    expect(bot).not.toContain("/role");
    expect(bot).not.toContain("agents.invalid");
    const bridge = row(owner, "GitHub bridge");
    expect(bridge).not.toContain("<details");
    expect(bridge).toContain(">@bridge-github</span>");

    await hub.db
      .update(membership)
      .set({ role: "admin" })
      .where(eq(membership.id, ids.malik ?? ""));
    const admin = section(main(await page("/console/members", team.malik.cookie)), "members-h");
    expect(row(admin, "lea@acme.test")).not.toContain("<details");
    expect(row(admin, "sam@acme.test")).not.toContain("Make Sam an owner?");
    expect(row(admin, "sam@acme.test")).toContain("Make Sam an admin?");
    await hub.db
      .update(membership)
      .set({ role: "member" })
      .where(eq(membership.id, ids.malik ?? ""));
  });

  it("lists pending invitations with their count, each revoked after a confirmation", async () => {
    const pending = section(main(await page("/console/members", team.lea.cookie)), "invitations-h");
    expect(pending).toContain("Pending invitations");
    expect(pending).toContain('<span class="count">1</span>');
    const ines = row(pending, "ines@acme.test");
    expect(ines).toContain(">Member<");
    const revoke = ines.match(/<button[^>]*hx-post="\/console\/invitations\/[^"]+\/revoke"[^>]*>/)?.[0] ?? "";
    expect(revoke).toContain('class="danger"');
    expect(revoke).toContain('aria-label="Revoke the invitation for ines@acme.test…"');
    expect(revoke).toContain('data-confirm="Revoke the invitation for ines@acme.test?"');
    expect(revoke).toContain('data-done="Invitation for ines@acme.test revoked."');
    expect(ines).toContain(">Revoke…</button>");
  });

  it("with no pending invitation, says so and gives the command to copy beside the page's button", async () => {
    const fresh = await startHub();
    const t = await fresh.seed();
    const html = main(await (await fetch(`${fresh.url}/console/members`, { headers: { cookie: t.lea.cookie } })).text());
    await fresh.stop();
    const pending = section(html, "invitations-h");
    expect(pending).toContain('<p class="empty-title">No pending invitations.</p>');
    expect(pending).toContain("Use Invite a member, or run this in a terminal:");
    expect(pending).toMatch(/<div class="code" data-kind="command">\s*<pre>\s*<code translate="no">codetgh invite &lt;email&gt;<\/code>/);
    expect(pending).toContain('aria-label="Copy the invite command"');
  });

  it("folds the invitation form under the page header: labelled fields, the roles in words, the length in days", async () => {
    const html = main(await page("/console/members", team.lea.cookie));
    const head = html.slice(html.indexOf('<div class="page-head">'), html.indexOf("Pending invitations"));
    expect(head).toContain("<summary>Invite a member</summary>");
    const form = head.slice(head.indexOf('<form hx-post="/console/members/invite"'));
    expect(form).toContain('<label for="invite-email">Email</label>');
    expect(form).toContain('type="email"');
    expect(form).toContain('<option value="member" selected="">Member</option>');
    // Only an owner invites an owner.
    expect(form).toContain('<option value="owner">Owner</option>');
    await hub.db
      .update(membership)
      .set({ role: "admin" })
      .where(eq(membership.id, ids.malik ?? ""));
    expect(main(await page("/console/members", team.malik.cookie))).not.toContain('<option value="owner">');
    await hub.db
      .update(membership)
      .set({ role: "member" })
      .where(eq(membership.id, ids.malik ?? ""));
    expect(form).toContain("Guests see only their own threads.");
    expect(form).toContain('<label for="invite-days">Valid for</label>');
    expect(form).toMatch(/name="days"[^>]*>\s*<span>days<\/span>/);
    expect(form).toContain(">Invite</button>");
  });

  it("gives the invitation link in a block to copy, and how long it lasts", async () => {
    const html = await (
      await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "zoe@acme.test", role: "member", days: "3" })
    ).text();
    expect(html).toContain('<div class="banner" data-tone="info" role="status">');
    expect(html).toContain("Send this link to zoe@acme.test.");
    expect(html).toContain("It&#39;s valid for 3\u00a0days.");
    expect(html).toMatch(/<code translate="no">http:\/\/[^<]+\/invite\/[A-Za-z0-9_-]{32}<\/code>/);
    expect(html).toContain('aria-label="Copy the invitation link"');
  });

  it("is in French", async () => {
    const html = main(await page("/console/members", team.lea.cookie, "fr"));
    expect(html).toContain("Membres de l&#39;équipe");
    expect(html).toContain("Invitations en attente");
    expect(html).toContain("<summary>Inviter un membre</summary>");
    // A role change in French takes no agreement with the person: "Passer Sam en invité ?", and the menu says it the same way.
    expect(html).toContain("Passer Sam en admin\u202f?");
    expect(html).toContain("Passer Sam en invité\u202f?");
    expect(html).toContain(">Passer en invité…</button>");
    expect(html).toContain("Les sessions déléguées de cette personne cessent de prendre des demandes");
    expect(html).not.toContain("Ses ");
    expect(html).toContain(">Date d&#39;arrivée</th>");
    expect(html).toContain("Révoquer l&#39;invitation de ines@acme.test\u202f?");
    expect(html).toContain(">Propriétaire<");
    expect(html).toContain(">Toi</span>");
    expect(html).toContain('aria-label="Révoquer l&#39;accès de Sam…"');
  });
});

describe("tokens", () => {
  it("lists a person's tokens: label, when it was made and ends, each revoked after a confirmation", async () => {
    const html = main(await page("/console/tokens", team.sam.cookie));
    const laptop = row(html, "sam laptop");
    // Nothing in the hub records a token's last use: the list does not claim one.
    expect(html).not.toContain("Last used");
    expect(html).not.toContain("Not used yet");
    expect(laptop).toMatch(/<time[^>]*>in 90 days<\/time>/);
    const revoke = laptop.match(/<button[^>]*hx-post="\/console\/tokens\/[^"]+\/revoke"[^>]*>/)?.[0] ?? "";
    expect(revoke).toContain('class="danger"');
    expect(revoke).toContain('aria-label="Revoke the token sam laptop…"');
    expect(revoke).toContain('data-confirm="Revoke the token sam laptop?"');
    expect(revoke).toContain('data-done="Token sam laptop revoked."');
    // With tokens, the form waits behind its button in the page header.
    expect(html).toContain('<details class="panel"><summary>Create a token</summary>');
  });

  it("says when a token has expired", async () => {
    await hub.db
      .update(personalToken)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(personalToken.userId, team.malik.userId));
    const malik = row(main(await page("/console/tokens", team.malik.cookie)), "malik laptop");
    expect(malik).toContain('<span class="pill" data-tone="neutral">Expired</span>');
    await hub.db
      .update(personalToken)
      .set({ expiresAt: new Date(Date.now() + 90 * 86_400_000) })
      .where(eq(personalToken.userId, team.malik.userId));
  });

  it("with no token yet, says so and opens the form", async () => {
    const fresh = await startHub();
    const t = await fresh.seed();
    await fresh.db.delete(personalToken).where(eq(personalToken.userId, t.sam.userId));
    const html = main(await (await fetch(`${fresh.url}/console/tokens`, { headers: { cookie: t.sam.cookie } })).text());
    await fresh.stop();
    expect(html).toContain('<p class="empty-title">No personal tokens yet.</p>');
    expect(html).toContain("Create one to sign in a terminal.");
    expect(html).toContain('<details class="panel" open=""><summary>Create a token</summary>');
    expect(html).toContain('<label for="token-label">Label</label>');
    expect(html).not.toContain("<table");
  });

  it("shows a new token once, with the commands that use it", async () => {
    const html = await (await consolePost(hub.url, team.sam.cookie, "/console/tokens", { label: "ci" })).text();
    expect(html).toContain('<div class="banner" data-tone="warn" role="status">');
    expect(html).toContain("Token created. Copy it now: you won&#39;t see it again.");
    expect(html).toMatch(/<code translate="no">ctgh_[A-Za-z0-9_-]{43}<\/code>/);
    expect(html).toContain('aria-label="Copy the token"');
    expect(html).toContain(`codetgh login --url ${hub.url} --token-stdin`);
    expect(html).toContain("claude plugin install codetgh@&lt;marketplace&gt;");
    expect(html).toContain('data-kind="command"');
  });

  it("is in French", async () => {
    const html = main(await page("/console/tokens", team.sam.cookie, "fr"));
    expect(html).toContain("<h1>Jetons personnels</h1>");
    expect(html).toContain("<summary>Créer un jeton</summary>");
    expect(html).toContain("Révoquer le jeton sam laptop\u202f?");
  });
});

describe("my data", () => {
  it("groups the profile, the export, Slack and erasing, the last one as a danger", async () => {
    const html = main(await page("/console/me", team.sam.cookie));
    expect(html).toContain('<label for="me-name">Display name</label>');
    expect(html).toContain("Your teammates see it next to your handle, @sam.");
    expect(html).toContain('<a class="button" href="/console/me/export">Download my data</a>');
    expect(html).toContain('<form hx-post="/console/me/slack" hx-target="#slack-code">');
    expect(html).toContain(">Link Slack</button>");
    const erase = html.slice(html.indexOf('data-tone="danger"'));
    expect(erase).toContain("Erase my data</h2>");
    // The word to type is set apart, in mono; the label still reads "Type erase to confirm".
    expect(erase).toContain('<label for="me-erase">Type <code>erase</code> to confirm</label>');
    expect(erase).toContain('<button type="submit" class="danger">Erase my data</button>');
  });

  it("gives the Slack code in a block to copy", async () => {
    const html = await (await consolePost(hub.url, team.sam.cookie, "/console/me/slack")).text();
    expect(html).toContain("Type this in Slack within 10\u00a0minutes.");
    expect(html).toMatch(/<code translate="no">\/codetgh-link [A-Z0-9]{8}<\/code>/);
    expect(html).toContain('aria-label="Copy the Slack command"');
  });

  it("is in French", async () => {
    const html = main(await page("/console/me", team.sam.cookie, "fr"));
    expect(html).toContain("<h1>Mes données</h1>");
    expect(html).toContain("Effacer mes données</h2>");
    expect(html).toContain("Tape <code>erase</code> pour confirmer");
    expect(html).toContain(">Relier Slack</button>");
  });
});

describe("settings", () => {
  it("keeps every field name, with a label, a help line instead of parentheses, and the choice in words", async () => {
    const html = main(await page("/console/settings", team.lea.cookie));
    expect(html).toContain('<label for="team-name">Team name</label>');
    const form = html.slice(
      html.indexOf('<form hx-post="/console/settings"'),
      html.indexOf("</form>", html.indexOf('hx-post="/console/settings"')),
    );
    expect(form).toContain('data-done="Settings saved."');
    expect(form).toContain("<legend>When an agent edits a file someone else claimed</legend>");
    expect(form).toMatch(/<input type="radio" name="claims_enforcement" value="ask" checked=""[^>]*>/);
    expect(form).toMatch(/<input type="radio" name="claims_enforcement" value="warn"[^>]*>/);
    expect(form).toContain('<option value="member" selected="">Members, admins and owners</option>');
    expect(form).toContain('<option value="owner">Owners only</option>');
    for (const name of ["memory_accept_via_mcp", "auto_link_projects", "push_rewake"])
      expect(form).toMatch(new RegExp(`<input type="checkbox" name="${name}" value="on"[^>]*aria-describedby="${name}-help"`));
    // A command in a help line is a machine value: in mono.
    expect(form).toContain("Otherwise an admin runs <code>codetgh project new</code>.");
    expect(form).not.toMatch(/<label[^>]*>[^<]*\(/);
    expect(form).toMatch(/name="retention_days"[^>]*>\s*<span>days<\/span>/);
    expect(form).toContain('name="secret_patterns"');
    expect(form).toContain('name="slack_channel"');
    expect(form).toContain('name="loop_orchestrator"');
  });

  it("renames the team first, by its own button; then one group that Save settings closes and names; then the GitHub bridge", async () => {
    const html = main(await page("/console/settings", team.lea.cookie));
    const settings = html.indexOf('<form hx-post="/console/settings"');
    expect(html.indexOf('<form hx-post="/console/settings/team"')).toBeGreaterThan(0);
    expect(html.indexOf('<form hx-post="/console/settings/team"')).toBeLessThan(settings);
    const end = html.indexOf("</form>", settings);
    const form = html.slice(settings, end);
    for (const title of ["Agent rules", "Memory", "Messages", "Slack bridge"]) expect(form).toContain(`>${title}</h2>`);
    // The button closes the group and says what it saves; nothing the form does not save sits between its sections.
    expect(form).toMatch(
      /<button type="submit" class="primary" aria-describedby="settings-save-help">Save settings<\/button>\s*<p class="help" id="settings-save-help">Saves the agent rules, memory, messages and the Slack channel\.<\/p>\s*<\/div>$/,
    );
    expect(form).not.toContain("GitHub");
    // The Slack bridge is the group's last section; the GitHub bridge comes right after it.
    expect(form.slice(form.lastIndexOf("<h2"))).toMatch(/^<h2[^>]*>Slack bridge<\/h2>/);
    expect(html.slice(end)).toMatch(/^<\/form>\s*<section class="panel"><h2>GitHub bridge<\/h2>/);
  });

  it("says whether the GitHub webhook is set, and asks before replacing its secret", async () => {
    const before = main(await page("/console/settings", team.lea.cookie));
    expect(before).toContain('<span class="pill" data-tone="neutral">Not configured</span>');
    expect(button(before, "/console/settings/github")).not.toContain("data-confirm");
    const created = await (await consolePost(hub.url, team.lea.cookie, "/console/settings/github")).text();
    expect(created).toContain('<div class="banner" data-tone="warn" role="status">');
    expect(created).toContain("Copy the secret now: you won&#39;t see it again.");
    // GitHub takes them in two fields: each value in its own block, under its name, with its own Copy.
    expect(created).toMatch(
      /Webhook URL<\/p>\s*<div class="code">\s*<pre>\s*<code translate="no">http:\/\/[^<\s]+\/bridges\/github\/[A-Za-z0-9_-]+<\/code>/,
    );
    expect(created).toMatch(/Webhook secret<\/p>\s*<div class="code">\s*<pre>\s*<code translate="no">[A-Za-z0-9_-]{20,}<\/code>/);
    expect(created).toContain('aria-label="Copy the webhook URL"');
    expect(created).toContain('aria-label="Copy the secret"');
    const after = main(await page("/console/settings", team.lea.cookie));
    expect(after).toContain('<span class="pill" data-tone="ok">Webhook configured</span>');
    const replace = button(after, "/console/settings/github");
    expect(replace).toContain('data-confirm="Replace the webhook secret?"');
    expect(after).toContain(">Replace the webhook secret…</button>");
  });

  it("gives the audit public key in a block to copy, with the command that uses it", async () => {
    const html = main(await page("/console/settings", team.lea.cookie));
    expect(html).toContain('aria-label="Copy the public key"');
    expect(html).toContain("codetgh audit verify &lt;file&gt; --public-key");
  });

  it("shows a long team name and many patterns without losing them", async () => {
    const name = "Acme web, projet de fin d'études, promotion 2026, groupe B (plateforme)";
    await hub.db.update(teamTable).set({ name }).where(eq(teamTable.id, team.teamId));
    const html = main(await page("/console/settings", team.lea.cookie));
    expect(html).toContain('value="Acme web, projet de fin d&#39;études, promotion 2026, groupe B (plateforme)"');
    await hub.db.update(teamTable).set({ name: "Acme web" }).where(eq(teamTable.id, team.teamId));
  });

  it("is in French", async () => {
    const html = main(await page("/console/settings", team.lea.cookie, "fr"));
    expect(html).toContain("<h1>Paramètres</h1>");
    expect(html).toContain("Demander à la personne");
    expect(html).toContain("Enregistrer les paramètres");
    expect(html).toContain("Membres, admins et propriétaires");
  });
});

describe("refusals", () => {
  // The hub's own refusals of this batch's forms say what happened and how to fix it, in the page's language.
  const refused = async (cookie: string, path: string, form: Record<string, string>) => {
    const res = await consolePost(hub.url, cookie, path, form);
    expect(res.status).toBe(400);
    return res.text();
  };

  it("an invitation to an address that isn't one, or for too long", async () => {
    const invite = { role: "member", days: "7" };
    expect(await refused(team.lea.cookie, "/console/members/invite", { ...invite, email: "not-an-email" })).toContain(
      "This email address isn&#39;t valid. Enter the address to invite, like name@example.com.",
    );
    expect(await refused(team.lea.cookie, "/console/members/invite", { ...invite, email: "zoe@acme.test", days: "31" })).toContain(
      "An invitation lasts 1 to 30 days. Enter a number of days in that range.",
    );
    expect(await refused(`${team.lea.cookie}; lang=fr`, "/console/members/invite", { ...invite, email: "not-an-email" })).toContain(
      "Cette adresse de courriel n&#39;est pas valable. Saisis l&#39;adresse à inviter, comme nom@exemple.com.",
    );
  });

  it("erasing without the typed word", async () => {
    expect(await refused(team.sam.cookie, "/console/me/erase", { confirm: "nope" })).toContain(
      "Nothing was erased. Type erase in the box to confirm.",
    );
    expect(await refused(`${team.sam.cookie}; lang=fr`, "/console/me/erase", { confirm: "nope" })).toContain(
      "Rien n&#39;a été effacé. Tape erase dans le champ pour confirmer.",
    );
  });
});
