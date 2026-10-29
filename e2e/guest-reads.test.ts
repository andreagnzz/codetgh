import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { membership } from "../apps/hub/src/db/schema.js";
import { createInvitation } from "../apps/hub/src/domain/teams.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost, hubRest } from "./helpers.js";

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
  // A repository tells a guest nothing, not even that it is a team project: no session there.
  const started = await startSession(hub.url, team.malik.token, "malik-g2", { repo: ACME_REPO });
  expect(started.agent_id).toBeNull();
  // Their own messages still arrive, in codetgh inbox.
  expect(JSON.stringify(await (await hubRest(hub.url, team.malik.token, "POST", "/v1/inbox", {})).json())).toContain("hello guest");

  // A session started outside a repository is theirs: it reads what is sent to it through MCP, and nothing of the team.
  const own = await startSession(hub.url, team.malik.token, "malik-g3");
  expect(own.agent_id).toMatch(/^agt_/);
  expect(own.context).not.toMatch(/src\/billing|Billing moves/);
  const lea = await mcpClient(hub.url, team.lea.token);
  expect((await call(lea, "send_message", { to: `agent:${own.agent_id}`, kind: "note", body: "for your session" })).isError).toBe(false);
  await lea.close();
  const read = (await call(malik, "inbox_read", { agent: own.agent_id })).text;
  expect(read).toContain("for your session");
  expect(read).not.toContain("team only plan");
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
  await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session", {
    session_id: "sam-g",
    repo_fingerprint: "b".repeat(64),
    repo_name: "acme/ledger-secret",
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

it("lists a guest's threads without project headings, which would name the team's repositories", async () => {
  const session = await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session", {
    session_id: "sam-g-thread",
    repo_fingerprint: "b".repeat(64),
    repo_name: "acme/ledger-secret",
  });
  const { agent_id } = (await session.json()) as { agent_id: string };
  const sam = await mcpClient(hub.url, team.sam.token);
  const sent = JSON.parse(
    (await call(sam, "send_message", { agent: agent_id, to: "@malik", kind: "note", body: "from the ledger", allow_offline: true })).text,
  );
  await sam.close();
  const html = await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.malik.cookie } })).text();
  expect(html).toContain(sent.thread);
  expect(html).not.toContain("acme/ledger-secret");
  // A member still sees the threads under their project.
  expect(await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.sam.cookie } })).text()).toContain(
    "acme/ledger-secret",
  );
});

const FORBIDDEN = ["projects", "tasks", "memory", "claims", "delegations", "tokens"];
it("shows a guest no link to a page that refuses them, and a member every one", async () => {
  const nav = async (cookie: string) => {
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
    // The side navigation, and the top bar's account menu (My data, Tokens).
    return html.slice(html.indexOf("<aside"), html.indexOf("</header>"));
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
