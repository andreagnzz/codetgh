import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { membership } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let taskId: string;
let memoryId: string;
let teamThread: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.lea.token, "lea-g", { repo: ACME_REPO });
  await startSession(hub.url, team.malik.token, "malik-g", { repo: ACME_REPO });
  const lea = await mcpClient(hub.url, team.lea.token);
  taskId = JSON.parse((await call(lea, "task_create", { title: "Rotate the billing keys" })).text).id;
  memoryId = JSON.parse((await call(lea, "memory_propose", { kind: "decision", title: "Billing moves to v2", body: "b" })).text).id;
  expect((await call(lea, "claim", { scope: ["src/billing/**"], mode: "exclusive", reason: "refactor" })).isError).toBe(false);
  await call(lea, "send_message", { to: "@malik", kind: "note", body: "hello guest" });
  // Made a guest before the team message, which then does not reach them.
  await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
  teamThread = JSON.parse((await call(lea, "send_message", { to: "@team", kind: "note", body: "team only plan" })).text).thread;
});
afterAll(() => hub.stop());

// SPEC, Rôles: a guest reads only the threads they take part in.
it("keeps tasks, memory, claims and the team view from a guest's agent", async () => {
  const malik = await mcpClient(hub.url, team.malik.token);
  for (const [tool, args] of [
    ["task_list", {}],
    ["memory_search", { query: "Billing", include_proposed: true }],
    ["team_overview", { scope: "team" }],
  ] as const) {
    expect((await call(malik, tool, args)).isError, tool).toBe(true);
  }
  for (const uri of [`codetgh://task/${taskId}`, `codetgh://memory/${memoryId}`, `codetgh://thread/${teamThread}`]) {
    await expect(malik.readResource({ uri }), uri).rejects.toThrow();
  }
  const status = await fetch(`${hub.url}/v1/status`, { headers: { Authorization: `Bearer ${team.malik.token}` } });
  expect(status.status).toBe(403);
  const started = await startSession(hub.url, team.malik.token, "malik-g2", { repo: ACME_REPO });
  expect(started.context).not.toMatch(/src\/billing|Billing moves/);
  // Their own messages still arrive.
  expect((await call(malik, "inbox_read", {})).text).toContain("hello guest");
});

it("keeps the same pages and thread actions from a guest in the console", async () => {
  const get = (path: string) => fetch(`${hub.url}${path}`, { headers: { cookie: team.malik.cookie }, redirect: "manual" });
  for (const path of [
    "/console/tasks",
    `/console/tasks/${taskId}`,
    "/console/memory",
    `/console/memory/${memoryId}`,
    "/console/claims",
    `/console/threads/${teamThread}`,
  ])
    expect((await get(path)).status, path).toBe(403);
  expect(await (await get("/console")).text()).not.toContain("team only plan");
  expect((await consolePost(hub.url, team.malik.cookie, `/console/threads/${teamThread}/mute`)).status).toBe(403);
});
