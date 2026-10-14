import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  it("says what to do when no session is linked to a project yet", async () => {
    expect(await page(team.sam.cookie)).toContain("No project yet. A project appears when someone starts Claude Code in a repository");
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
