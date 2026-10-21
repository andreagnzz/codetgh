import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, message, project, task } from "../src/db/schema.js";
import { resolveAgent } from "../src/domain/agents.js";
import { principalForUser } from "../src/principal.js";
import { call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const ids: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  // Seen in production: one personal token, two Claude Code sessions on two projects.
  ids.webapp = (await startSession(hub.url, team.malik.token, "malik-webapp", { repo: repoFingerprint("git@github.com:acme/webapp.git") }))
    .agent_id as string;
  ids.billing = (
    await startSession(hub.url, team.malik.token, "malik-billing", { repo: repoFingerprint("git@github.com:acme/billing.git") })
  ).agent_id as string;
});
afterAll(() => hub.stop());

const projectOf = async (name: string) => (await hub.db.select().from(project).where(eq(project.name, name)))[0]?.id;
const agentRow = async (id: string | null) =>
  (
    await hub.db
      .select()
      .from(agent)
      .where(eq(agent.id, id ?? ""))
  )[0];

it("never guesses the session when the token has several live ones: the call goes to the token's auto agent", async () => {
  const malik = await mcpClient(hub.url, team.malik.token);
  const created = await call(malik, "task_create", { title: "who made me" });
  expect(created.isError).toBe(false);
  const [t] = await hub.db.select().from(task).where(eq(task.title, "who made me"));
  expect(t?.createdByAgent).not.toBe(ids.billing);
  expect(t?.createdByAgent).not.toBe(ids.webapp);
  expect((await agentRow(t?.createdByAgent ?? null))?.sessionId).toMatch(/^auto-/);
  expect(t?.projectId).toBeNull();

  const sent = JSON.parse((await call(malik, "send_message", { to: "@lea", kind: "note", body: "from nowhere" })).text) as { id: string };
  const [m] = await hub.db.select().from(message).where(eq(message.id, sent.id));
  const from = await agentRow(m?.fromAgentId ?? null);
  expect(from?.sessionId).toMatch(/^auto-/);
  expect(from?.projectId).toBeNull();
  await malik.close();
});

it("attributes a call that names its agent to that session and its project", async () => {
  const malik = await mcpClient(hub.url, team.malik.token);
  expect((await call(malik, "task_create", { agent: ids.webapp, title: "made on webapp" })).isError).toBe(false);
  const [t] = await hub.db.select().from(task).where(eq(task.title, "made on webapp"));
  expect(t?.createdByAgent).toBe(ids.webapp);
  expect(t?.projectId).toBe(await projectOf("acme/webapp"));
  // Another person's agent is refused.
  const lea = await mcpClient(hub.url, team.lea.token);
  expect(JSON.parse((await call(lea, "task_create", { agent: ids.webapp, title: "stolen" })).text).code).toBe("E_FORBIDDEN");
  await lea.close();
  await malik.close();
});

it("keeps today's behaviour with a single live session", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const only = (await startSession(hub.url, team.sam.token, "sam-only", { repo: repoFingerprint("git@github.com:acme/api.git") })).agent_id;
  expect((await call(sam, "task_create", { title: "single session" })).isError).toBe(false);
  const [t] = await hub.db.select().from(task).where(eq(task.title, "single session"));
  expect(t?.createdByAgent).toBe(only);
  expect(t?.projectId).toBe(await projectOf("acme/api"));
  await sam.close();
});

// Seen in production: the claude.ai connector's tools, called from a Claude Code session, go through OAuth with no agent.
it("gives an OAuth call with no agent the person's auto agent while they run several sessions, and honours a named one", async () => {
  const oauth = await principalForUser(hub.db, team.malik.userId, "oauth");
  if (!oauth) throw new Error("no principal");
  const guessed = await resolveAgent(hub.db, oauth, undefined, "mcp");
  expect(guessed.sessionId).toBe("auto-oauth");
  expect(guessed.projectId).toBeNull();
  // Same person, same team: the session's agent is theirs whatever the way in.
  expect((await resolveAgent(hub.db, oauth, ids.webapp, "mcp")).id).toBe(ids.webapp);
  const lea = await principalForUser(hub.db, team.lea.userId, "oauth");
  if (!lea) throw new Error("no principal");
  await expect(resolveAgent(hub.db, lea, ids.webapp, "mcp")).rejects.toMatchObject({ code: "E_FORBIDDEN" });
});
