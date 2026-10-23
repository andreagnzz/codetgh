import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const session = async (token: string, id: string, repo: string) =>
  (await (
    await fetch(`${hub.url}/v1/agents/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        session_id: id,
        branch: "main",
        repo_fingerprint: repoFingerprint(`git@github.com:${repo}.git`),
        repo_name: repo,
      }),
    })
  ).json()) as { agent_id: string };

it("tells apart one person's sessions on the same branch: project and agent id", async () => {
  const web = await session(team.lea.token, "lea-web", "acme/webapp");
  const api = await session(team.lea.token, "lea-api", "acme/billing");
  const html = await (await fetch(`${hub.url}/console/agents`, { headers: { cookie: team.lea.cookie, "accept-language": "fr" } })).text();
  expect(html).toContain("Projet");
  expect(html).toContain("acme/webapp");
  expect(html).toContain("acme/billing");
  expect(html).toContain(web.agent_id.slice(-6));
  expect(html).toContain(api.agent_id.slice(-6));

  // Agents see the project too, in the team overview.
  const sam = await mcpClient(hub.url, team.sam.token);
  await startSession(hub.url, team.sam.token, "sam-ov");
  const overview = JSON.parse((await call(sam, "team_overview", { scope: "team" })).text);
  const lea = overview.people.find((p: { handle: string }) => p.handle === "lea");
  expect(lea.sessions.map((s: { project_untrusted: string }) => s.project_untrusted).sort()).toEqual(["acme/billing", "acme/webapp"]);
});
