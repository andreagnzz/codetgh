import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { membership, message, team as teamTable } from "../src/db/schema.js";
import { createExternalAgent } from "../src/domain/a2a.js";
import { changeRole, updateSettings } from "../src/domain/admin.js";
import { verifyChain } from "../src/domain/audit.js";
import { bridgeAuthor } from "../src/domain/bridges.js";
import { createGithubHook } from "../src/domain/github.js";
import { contextPacket } from "../src/domain/overview.js";
import { createInvitation, revokeMember, setMemberHandle } from "../src/domain/teams.js";
import { principalForToken } from "../src/principal.js";
import { call, csrf, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

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

  it("sends an htmx request without a session to /login with HX-Redirect, which htmx follows instead of swapping", async () => {
    const res = await fetch(`${hub.url}/console/kill-switch`, { method: "POST", headers: { "HX-Request": "true" }, redirect: "manual" });
    expect(res.status).toBe(204);
    expect(res.headers.get("hx-redirect")).toBe("/login");
    expect(res.headers.get("location")).toBeNull();
    expect((await fetch(`${hub.url}/console/kill-switch`, { method: "POST", redirect: "manual" })).status).toBe(302);
  });

  it("serves pages under a self-only CSP with no inline script", async () => {
    const res = await fetch(`${hub.url}/console`, { headers: { cookie: team.lea.cookie } });
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).not.toMatch(/<script>[^<]/);
  });

  it("refuses writes without the CSRF token", async () => {
    expect((await post("/console/settings", team.lea.cookie, null, { retention_days: "30" })).status).toBe(403);
    expect((await post("/console/settings", team.lea.cookie, "forged", { retention_days: "30" })).status).toBe(403);
    expect((await post("/console/settings", team.lea.cookie, await csrf(hub.url, team.lea.cookie), { retention_days: "30" })).status).toBe(
      204,
    );
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
    const res = await post("/console/settings", team.lea.cookie, await csrf(hub.url, team.lea.cookie), {
      retention_days: "90",
      secret_patterns: "(a+)+$",
    });
    expect(res.status).toBe(400);
  });

  it("offers and stores no strict mode, a setting that did nothing", async () => {
    const html = await (await fetch(`${hub.url}/console/settings`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).not.toContain('name="strict"');
    await post("/console/settings", team.lea.cookie, await csrf(hub.url, team.lea.cookie), { retention_days: "90", strict: "on" });
    const [row] = await hub.db.select({ settings: teamTable.settings }).from(teamTable).where(eq(teamTable.id, team.teamId));
    expect(row?.settings).not.toHaveProperty("strict");
  });

  it("saves every setting, and keeps the stored ones a bad or blank field would wipe", async () => {
    const settings = async () =>
      (await hub.db.select({ settings: teamTable.settings }).from(teamTable).where(eq(teamTable.id, team.teamId)))[0]?.settings;
    const save = async (form: Record<string, string>) =>
      post("/console/settings", team.lea.cookie, await csrf(hub.url, team.lea.cookie), form);
    expect(
      (await save({ retention_days: "30", memory_accept_by: "admin", memory_accept_via_mcp: "on", slack_channel: "C0123ABC" })).status,
    ).toBe(204);
    expect(await settings()).toMatchObject({
      retention_days: 30,
      memory_accept_by: "admin",
      memory_accept_via_mcp: true,
      slack_channel: "C0123ABC",
    });
    const bad = await save({ retention_days: "30", slack_channel: "not a channel" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Slack channel");
    expect((await save({ retention_days: "", slack_channel: "C0123ABC" })).status).toBe(204);
    expect(await settings()).toMatchObject({ retention_days: 30, slack_channel: "C0123ABC" });
    await save({ retention_days: "90" });
  });

  it("keeps a settings write made while the form was open", async () => {
    const stale = await principalForToken(hub.db, team.lea.token);
    if (!stale) throw new Error("setup");
    const fresh = await principalForToken(hub.db, team.lea.token);
    if (!fresh) throw new Error("setup");
    await createGithubHook(hub.db, fresh, "s");
    await updateSettings(hub.db, stale, { retentionDays: 90, secretPatterns: [] });
    const [row] = await hub.db.select({ settings: teamTable.settings }).from(teamTable).where(eq(teamTable.id, team.teamId));
    expect(row?.settings.github_hook).toBeDefined();
  });

  it("keeps admin pages from members", async () => {
    expect((await fetch(`${hub.url}/console/members`, { headers: { cookie: team.sam.cookie } })).status).toBe(403);
  });

  it("creates an invitation link and shows a token once", async () => {
    const invite = await (
      await post("/console/members/invite", team.lea.cookie, await csrf(hub.url, team.lea.cookie), {
        email: "zoe@acme.test",
        role: "member",
      })
    ).text();
    expect(invite).toMatch(new RegExp(`${hub.url}/invite/[A-Za-z0-9_-]{32}`));
    const created = await (await post("/console/tokens", team.sam.cookie, await csrf(hub.url, team.sam.cookie), { label: "ci" })).text();
    expect(created).toMatch(/ctgh_[A-Za-z0-9_-]{43}/);
  });

  it("escapes agent text in threads", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const sent = JSON.parse(
      (await call(sam, "send_message", { to: "@lea", kind: "note", body: "<img src=x onerror=alert(1)>", allow_offline: true })).text,
    );
    const html = await (await fetch(`${hub.url}/console/threads/${sent.thread}`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    await sam.close();
  });
});

describe("thread state", () => {
  it("says a person muted a thread they muted, not the loop guard", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const sent = JSON.parse((await call(sam, "send_message", { to: "@lea", kind: "note", body: "mute me", allow_offline: true })).text);
    const page = async () => (await fetch(`${hub.url}/console/threads/${sent.thread}`, { headers: { cookie: team.lea.cookie } })).text();
    expect(await page()).toContain("open");
    expect((await post(`/console/threads/${sent.thread}/mute`, team.lea.cookie, await csrf(hub.url, team.lea.cookie))).status).toBe(204);
    const muted = await page();
    expect(muted).toContain("muted by a person");
    expect(muted).not.toContain("loop guard");
    await sam.close();
  });
});

describe("roles", () => {
  it("leaves the hub's own members (a2a-, bridge-) out of role changes", async () => {
    const p = await principalForToken(hub.db, team.lea.token);
    if (!p) throw new Error("setup");
    const { handle } = await createExternalAgent(hub.db, p, "Partner bot");
    const [m] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.handle, handle.slice(1)));
    await expect(changeRole(hub.db, p, m?.id ?? "", "admin")).rejects.toThrow("system member");
    const [after] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.id, m?.id ?? ""));
    expect(after?.role).toBe("guest");
  });

  it("refuses to rename an a2a or bridge member, and keeps a renamed one out of role changes", async () => {
    const p = await principalForToken(hub.db, team.lea.token);
    if (!p) throw new Error("setup");
    const { handle } = await createExternalAgent(hub.db, p, "Renamed bot");
    const bridge = await bridgeAuthor(hub.db, p.teamId, "GitHub");
    const members = await hub.db.select().from(membership).where(eq(membership.teamId, p.teamId));
    const a2a = members.find((m) => m.handle === handle.slice(1));
    const gh = members.find((m) => m.userId === bridge.p.user.id);
    for (const m of [a2a, gh]) {
      await expect(setMemberHandle(hub.db, p, m?.id ?? "", `plain-${m?.handle.length}`)).rejects.toThrow("system member");
      // A handle changed before this check, or by hand: the member's kind still holds, not its handle.
      await hub.db
        .update(membership)
        .set({ handle: `legacy-${m?.handle}` })
        .where(eq(membership.id, m?.id ?? ""));
      await expect(changeRole(hub.db, p, m?.id ?? "", "admin")).rejects.toThrow("system member");
    }
  });

  it("re-reads an owner's role under the owners lock, so two owners demoting or revoking each other leave one owner", async () => {
    await hub.db.update(membership).set({ role: "owner" }).where(eq(membership.userId, team.sam.userId));
    const lea = await principalForToken(hub.db, team.lea.token);
    // Sam's request started while he was still an owner.
    const sam = await principalForToken(hub.db, team.sam.token);
    if (!lea || !sam) throw new Error("setup");
    await changeRole(hub.db, lea, sam.membershipId, "admin");
    await expect(changeRole(hub.db, sam, lea.membershipId, "admin")).rejects.toThrow("no longer an owner");
    await expect(
      revokeMember(hub.db, { teamId: team.teamId, membershipId: lea.membershipId, actorUserId: sam.user.id, actorRole: "owner" }),
    ).rejects.toThrow("no longer an owner");
    const [after] = await hub.db.select().from(membership).where(eq(membership.id, lea.membershipId));
    expect(after).toMatchObject({ role: "owner", status: "active" });
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.sam.userId));
  });
});

describe("kill switch", () => {
  it("refuses agent writes at once, keeps reads and the console, and resumes on confirmation", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const pending = call(sam, "ask_peer", { to: "@lea", question: "Encore là ?", wait_s: 30, allow_offline: true });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    expect((await post("/console/kill-switch", team.lea.cookie, await csrf(hub.url, team.lea.cookie), { reason: "incident" })).status).toBe(
      204,
    );
    const r = await call(sam, "send_message", { to: "@lea", kind: "note", body: "x" });
    expect(JSON.parse(r.text).code).toBe("E_KILL_SWITCH");
    expect((await pending).json().status).toBe("pending");
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await call(sam, "inbox_read")).isError).toBe(false);
    expect((await fetch(`${hub.url}/console`, { headers: { cookie: team.lea.cookie } })).status).toBe(200);
    expect(
      (await post("/console/kill-switch/resume", team.lea.cookie, await csrf(hub.url, team.lea.cookie), { confirm: "no" })).status,
    ).toBe(400);
    expect(
      (await post("/console/kill-switch/resume", team.lea.cookie, await csrf(hub.url, team.lea.cookie), { confirm: "yes" })).status,
    ).toBe(204);
    expect((await call(sam, "send_message", { to: "@lea", kind: "note", body: "back", allow_offline: true })).isError).toBe(false);
    await sam.close();
  });
});

describe("audit chain under concurrent writes", () => {
  it("stays intact", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const malik = await mcpClient(hub.url, team.malik.token);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(i % 2 ? lea : malik, "send_message", { to: "@sam", kind: "note", body: `n${i}`, allow_offline: true }),
      ),
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
