import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { membership } from "../apps/hub/src/db/schema.js";
import { createInvitation } from "../apps/hub/src/domain/teams.js";
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
    ["task_get", { task_id: taskId }],
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
  expect((await call(malik, "inbox_read", { agent: started.agent_id })).text).toContain("hello guest");
});

it("keeps the same pages and thread actions from a guest in the console", async () => {
  const get = (path: string) => fetch(`${hub.url}${path}`, { headers: { cookie: team.malik.cookie }, redirect: "manual" });
  for (const path of [
    "/console/tasks",
    `/console/tasks/${taskId}`,
    "/console/memory",
    `/console/memory/${memoryId}`,
    "/console/claims",
    "/console/projects",
    "/console/delegations",
    "/console/tokens",
    `/console/threads/${teamThread}`,
  ])
    expect((await get(path)).status, path).toBe(403);
  for (const path of ["/console/delegations/agt_x/stop", "/console/tokens", "/console/tokens/tok_x/revoke"])
    expect((await consolePost(hub.url, team.malik.cookie, path, { label: "x" })).status, path).toBe(403);
  expect(await (await get("/console")).text()).not.toContain("team only plan");
  expect((await consolePost(hub.url, team.malik.cookie, `/console/threads/${teamThread}/mute`)).status).toBe(403);
});

it("shows a guest only their own agents on the dashboard", async () => {
  const lea = await mcpClient(hub.url, team.lea.token);
  expect((await call(lea, "status_set", { text: "rotating billing keys quietly" })).isError).toBe(false);
  await lea.close();
  await fetch(`${hub.url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: "sam-g", repo_fingerprint: "b".repeat(64), repo_name: "acme/ledger-secret" }),
  });
  const html = await (await fetch(`${hub.url}/console`, { headers: { cookie: team.malik.cookie } })).text();
  const presence = html.slice(html.indexOf('id="presence-h"'), html.indexOf('id="todo-h"'));
  for (const leak of ["rotating billing keys quietly", "acme/ledger-secret", "lea@", "sam@"]) expect(html, leak).not.toContain(leak);
  for (const name of ["Léa", "Sam"]) expect(presence, name).not.toContain(name);
  expect(presence).toContain("Malik");
  // A member still sees the whole team.
  const member = await (await fetch(`${hub.url}/console`, { headers: { cookie: team.sam.cookie } })).text();
  expect(member).toContain("rotating billing keys quietly");
});

const FORBIDDEN = ["projects", "tasks", "memory", "claims", "delegations", "tokens"];
it("shows a guest no link to a page that refuses them, and a member every one", async () => {
  const nav = async (cookie: string) => {
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
    return html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  };
  const guest = await nav(team.malik.cookie);
  for (const page of FORBIDDEN) expect(guest, page).not.toContain(`href="/console/${page}"`);
  expect(guest).toContain('href="/console/threads"');
  expect(guest).toContain('href="/console/agents"');
  const member = await nav(team.sam.cookie);
  for (const page of FORBIDDEN) expect(member, page).toContain(`href="/console/${page}"`);
  for (const page of ["delegations", "tokens"])
    expect((await fetch(`${hub.url}/console/${page}`, { headers: { cookie: team.sam.cookie } })).status, page).toBe(200);
});

// A guest's agent still needs a personal token: it comes from the browser sign-in, not the Tokens page.
it("lets a guest sign in a terminal through the browser, and sends a new guest to the dashboard", async () => {
  const post = (path: string, body: unknown) =>
    fetch(`${hub.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s = (await (await post("/v1/device/start", { label: "malik-laptop" })).json()) as { device_code: string; user_code: string };
  expect((await consolePost(hub.url, team.malik.cookie, "/console/device/approve", { user_code: s.user_code })).status).toBe(200);
  const { token } = (await (await post("/v1/device/token", { device_code: s.device_code })).json()) as { token: string };
  expect((await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

  const invite = async (role: "guest" | "member") =>
    (
      await fetch(
        `${hub.url}/invite/${(await createInvitation(hub.db, { teamId: team.teamId, email: `${role}@acme.test`, role, invitedBy: null, via: "system" })).token}`,
      )
    ).text();
  expect(await invite("guest")).toContain('data-next="/console"');
  expect(await invite("member")).toContain('data-next="/console/tokens"');
});
