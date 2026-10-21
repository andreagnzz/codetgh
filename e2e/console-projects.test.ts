import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, auditEvent, membership, project } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const page = async (cookie: string, lang = "en") =>
  (await fetch(`${hub.url}/console/projects`, { headers: { cookie, "accept-language": lang } })).text();

describe("console: sessions by project", () => {
  it("says what to do when no repository is linked yet", async () => {
    await hub.db.delete(project);
    expect(await page(team.sam.cookie)).toContain("No project yet. A project appears when a member opens Claude Code in a repository");
    // Linked again, as codetgh project new would, for the tests below.
    for (const repo of ["acme/webapp", "acme/billing"])
      await hub.db.insert(project).values({
        id: `prj_${repo.slice(5)}`,
        teamId: team.teamId,
        name: repo,
        repoFingerprint: repoFingerprint(`git@github.com:${repo}.git`),
      });
  });

  it("lets any member see every member's sessions, grouped by project, with no message content", async () => {
    await startSession(hub.url, team.lea.token, "lea-proj", {
      repo: repoFingerprint("git@github.com:acme/webapp.git"),
      branch: "feat/login",
    });
    await startSession(hub.url, team.malik.token, "malik-proj", {
      repo: repoFingerprint("git@github.com:acme/billing.git"),
      branch: "fix/invoice",
    });
    const html = await page(team.sam.cookie);
    const webapp = html.indexOf("acme/webapp");
    expect(webapp).toBeGreaterThan(-1);
    expect(html).toContain("Léa");
    expect(html).toContain("feat/login");
    expect(html).toContain("Malik");
    expect(html).toContain("fix/invoice");
    expect(html).toMatch(/online/);
    // Sam is a plain member: still sees teammates' sessions on this page.
    expect(html).not.toContain("No project yet");
  });

  it("is in French when the browser asks", async () => {
    expect(await page(team.sam.cookie, "fr")).toContain("Projets");
  });
});

// The section of the page under a heading: from its <h2> to the end of its <section>.
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="p-${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};

describe("console: sessions outside a project", () => {
  it("lists sessions started outside a linked repository, without the CLI's REST agent", async () => {
    await startSession(hub.url, team.sam.token, "sam-loose", { branch: "scratch" });
    // GET /v1/status registers the token's REST agent (cli-…): not a Claude Code session.
    await fetch(`${hub.url}/v1/status`, { headers: { Authorization: `Bearer ${team.sam.token}` } });
    const html = await page(team.sam.cookie);
    const loose = section(html, "none");
    expect(loose).toContain("Sessions outside a project");
    expect(loose).toContain("Start claude inside the project&#39;s repository folder to link the session.");
    expect(loose).toContain("sam@scratch");
    expect(loose).not.toContain("sam@cli");
    expect(loose).not.toContain("feat/login");
    expect(section(html, "prj_webapp")).not.toContain("sam@scratch");
    expect(section(await page(team.sam.cookie, "fr"), "none")).toContain("Sessions hors projet");
  });

  it("lets a member attach their own session to a project, an admin anyone's, never a guest", async () => {
    const own = (await startSession(hub.url, team.sam.token, "sam-loose", { branch: "scratch" })).agent_id ?? "";
    const malik = (await startSession(hub.url, team.malik.token, "malik-loose", { branch: "spike" })).agent_id ?? "";
    const [cli] = await hub.db
      .select()
      .from(agent)
      .where(and(eq(agent.userId, team.sam.userId), like(agent.sessionId, "cli-%")));
    const attach = (cookie: string, id: string) =>
      consolePost(hub.url, cookie, `/console/agents/${id}/project`, { project_id: "prj_webapp" });

    expect((await attach(team.sam.cookie, malik)).status).toBe(403);
    expect(cli).toBeDefined();
    expect((await attach(team.sam.cookie, cli?.id ?? "")).status).toBe(403);
    expect((await attach(team.sam.cookie, own)).status).toBe(204);
    let html = await page(team.sam.cookie);
    expect(section(html, "prj_webapp")).toContain("sam@scratch");
    expect(section(html, "none")).not.toContain("sam@scratch");
    const audit = await hub.db.select().from(auditEvent).where(eq(auditEvent.subjectId, own));
    expect(audit.map((e) => e.action)).toContain("agent.project_set");

    // The session's next SessionStart (resume, compact) keeps the project.
    await startSession(hub.url, team.sam.token, "sam-loose", { branch: "scratch" });
    expect(section(await page(team.sam.cookie), "prj_webapp")).toContain("sam@scratch");

    // Léa is the owner: she attaches anyone's session.
    expect((await attach(team.lea.cookie, malik)).status).toBe(204);
    html = await page(team.lea.cookie);
    expect(section(html, "prj_webapp")).toContain("malik@spike");

    const guest = (await startSession(hub.url, team.malik.token, "malik-guest", { branch: "peek" })).agent_id ?? "";
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    expect((await attach(team.malik.cookie, guest)).status).toBe(403);
  });
});
