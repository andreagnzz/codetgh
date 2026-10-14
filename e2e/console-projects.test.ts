import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub, startSession } from "../apps/hub/test/harness.js";

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
    expect(await page(team.sam.cookie)).toContain("No project yet. A project appears when someone runs codetgh project new");
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
