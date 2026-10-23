import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const agentsPage = async (cookie: string) => (await fetch(`${hub.url}/console/agents`, { headers: { cookie } })).text();

it("removes an agent from the lists, keeps its history, and brings it back if the session resumes", async () => {
  const old = (await startSession(hub.url, team.sam.token, "sam-old")).agent_id ?? "";
  const lea = (await startSession(hub.url, team.lea.token, "lea-live")).agent_id ?? "";
  expect(await agentsPage(team.sam.cookie)).toContain(old.slice(-6));

  // A member removes only their own agents; an admin any agent of the team.
  expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${lea}/remove`)).status).toBe(403);
  expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${old}/remove`)).status).toBe(204);
  expect(await agentsPage(team.sam.cookie)).not.toContain(old.slice(-6));
  const [row] = await hub.db.select().from(agent).where(eq(agent.id, old));
  expect(row?.endedAt).not.toBeNull();

  // Other agents no longer see it either.
  const leaMcp = await mcpClient(hub.url, team.lea.token);
  const overview = JSON.parse((await call(leaMcp, "team_overview", { scope: "team" })).text);
  expect(overview.people.flatMap((p: { sessions: { agent: string }[] }) => p.sessions.map((s) => s.agent))).not.toContain(old);

  // claude --continue on the same session: it is a live session again.
  expect((await startSession(hub.url, team.sam.token, "sam-old")).agent_id).toBe(old);
  expect(await agentsPage(team.sam.cookie)).toContain(old.slice(-6));

  expect((await consolePost(hub.url, team.lea.cookie, `/console/agents/${old}/remove`)).status).toBe(204);
});
