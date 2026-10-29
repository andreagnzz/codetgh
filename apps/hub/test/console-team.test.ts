import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { membership } from "../src/db/schema.js";
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
    expect(revoke).toContain('aria-label="Revoke access Sam…"');
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
    expect(html).toContain('<div class="banner" data-tone="success" role="status">');
    expect(html).toContain("Invitation ready for zoe@acme.test.");
    expect(html).toContain("Send them this link. It&#39;s valid for 3\u00a0days.");
    expect(html).toMatch(/<code translate="no">http:\/\/[^<]+\/invite\/[A-Za-z0-9_-]{32}<\/code>/);
    expect(html).toContain('aria-label="Copy the invitation link"');
  });

  it("is in French", async () => {
    const html = main(await page("/console/members", team.lea.cookie, "fr"));
    expect(html).toContain("Membres de l&#39;équipe");
    expect(html).toContain("Invitations en attente");
    expect(html).toContain("<summary>Inviter un membre</summary>");
    expect(html).toContain("Faire de Sam un admin\u202f?");
    expect(html).toContain("Révoquer l&#39;invitation de ines@acme.test\u202f?");
    expect(html).toContain(">Propriétaire<");
    expect(html).toContain(">Toi</span>");
  });
});
