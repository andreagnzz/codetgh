import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { message } from "../src/db/schema.js";
import { verifyChain } from "../src/domain/audit.js";
import { contextPacket } from "../src/domain/overview.js";
import { createInvitation } from "../src/domain/teams.js";
import { principalForToken } from "../src/principal.js";
import { call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

async function csrf(cookie: string) {
  const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
  return html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;/)?.[1] ?? "";
}

const post = (path: string, cookie: string, token: string | null, form: Record<string, string> = {}) =>
  fetch(`${hub.url}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", ...(token !== null && { "X-CSRF-Token": token }) },
    body: new URLSearchParams(form).toString(),
  });

describe("console", () => {
  it("redirects to /login without a session", async () => {
    const res = await fetch(`${hub.url}/console`, { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("serves pages under a self-only CSP with no inline script", async () => {
    const res = await fetch(`${hub.url}/console`, { headers: { cookie: team.lea.cookie } });
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).not.toMatch(/<script>[^<]/);
  });

  it("refuses writes without the CSRF token", async () => {
    expect((await post("/console/settings", team.lea.cookie, null, { retention_days: "30" })).status).toBe(403);
    expect((await post("/console/settings", team.lea.cookie, "forged", { retention_days: "30" })).status).toBe(403);
    expect((await post("/console/settings", team.lea.cookie, await csrf(team.lea.cookie), { retention_days: "30" })).status).toBe(204);
  });

  it("shows the invitation page with a sign-up form, and nothing for a bad link", async () => {
    const { token } = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "ines@acme.test",
      role: "member",
      invitedBy: null,
      via: "system",
    });
    const html = await (await fetch(`${hub.url}/invite/${token}`)).text();
    expect(html).toContain('id="invite-signup"');
    expect(html).toContain("ines@acme.test");
    expect(await (await fetch(`${hub.url}/invite/nope`)).text()).toContain("no longer valid");
  });

  it("refuses secret patterns that could hang the hub", async () => {
    const res = await post("/console/settings", team.lea.cookie, await csrf(team.lea.cookie), {
      retention_days: "90",
      secret_patterns: "(a+)+$",
    });
    expect(res.status).toBe(400);
  });

  it("keeps admin pages from members", async () => {
    expect((await fetch(`${hub.url}/console/members`, { headers: { cookie: team.sam.cookie } })).status).toBe(403);
  });

  it("creates an invitation link and shows a token once", async () => {
    const invite = await (
      await post("/console/members/invite", team.lea.cookie, await csrf(team.lea.cookie), { email: "zoe@acme.test", role: "member" })
    ).text();
    expect(invite).toMatch(new RegExp(`${hub.url}/invite/[A-Za-z0-9_-]{32}`));
    const created = await (await post("/console/tokens", team.sam.cookie, await csrf(team.sam.cookie), { label: "ci" })).text();
    expect(created).toMatch(/ctgh_[A-Za-z0-9_-]{43}/);
  });

  it("escapes agent text in threads", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const sent = JSON.parse((await call(sam, "send_message", { to: "@lea", kind: "note", body: "<img src=x onerror=alert(1)>" })).text);
    const html = await (await fetch(`${hub.url}/console/threads/${sent.thread}`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    await sam.close();
  });
});

describe("kill switch", () => {
  it("refuses agent writes at once, keeps reads and the console, and resumes on confirmation", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const pending = call(sam, "ask_peer", { to: "@lea", question: "Encore là ?", wait_s: 30 });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    expect((await post("/console/kill-switch", team.lea.cookie, await csrf(team.lea.cookie), { reason: "incident" })).status).toBe(204);
    const r = await call(sam, "send_message", { to: "@lea", kind: "note", body: "x" });
    expect(JSON.parse(r.text).code).toBe("E_KILL_SWITCH");
    expect((await pending).json().status).toBe("pending");
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await call(sam, "inbox_read")).isError).toBe(false);
    expect((await fetch(`${hub.url}/console`, { headers: { cookie: team.lea.cookie } })).status).toBe(200);
    expect((await post("/console/kill-switch/resume", team.lea.cookie, await csrf(team.lea.cookie), { confirm: "no" })).status).toBe(400);
    expect((await post("/console/kill-switch/resume", team.lea.cookie, await csrf(team.lea.cookie), { confirm: "yes" })).status).toBe(204);
    expect((await call(sam, "send_message", { to: "@lea", kind: "note", body: "back" })).isError).toBe(false);
    await sam.close();
  });
});

describe("audit chain under concurrent writes", () => {
  it("stays intact", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const malik = await mcpClient(hub.url, team.malik.token);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => call(i % 2 ? lea : malik, "send_message", { to: "@sam", kind: "note", body: `n${i}` })),
    );
    expect(await verifyChain(hub.db, team.teamId)).toBeNull();
    await lea.close();
    await malik.close();
  });
});

describe("context packet", () => {
  it("stays under 4 800 characters with a busy team and never carries message text", async () => {
    const { agent_id } = await startSession(hub.url, team.sam.token, "sam-packet");
    for (let i = 0; i < 30; i++) await startSession(hub.url, team.lea.token, `lea-${i}-${"x".repeat(150)}`);
    const p = await principalForToken(hub.db, team.sam.token);
    if (!p || !agent_id) throw new Error("setup");
    const [me] = await hub.db.select().from(message).where(eq(message.fromUserId, team.lea.userId)).limit(1);
    const packet = await contextPacket(hub.db, p, { id: agent_id, projectId: null } as never);
    expect(packet.length).toBeLessThanOrEqual(4800);
    if (me) expect(packet).not.toContain(me.body);
  });
});
