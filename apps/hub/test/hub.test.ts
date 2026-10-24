import { WhoamiSchema } from "@codetgh/shared";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVITE_HEADER } from "../src/auth.js";
import { auditEvent, membership } from "../src/db/schema.js";
import { verifyChain } from "../src/domain/audit.js";
import { createInvitation, createTeam } from "../src/domain/teams.js";
import { principalForUser } from "../src/principal.js";
import { call, type Hub, mcpClient, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;

beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

describe("OAuth discovery (SPEC « Exigences côté hub »)", () => {
  it("answers 401 with a resource_metadata challenge without a token", async () => {
    const res = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${hub.url}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("publishes protected resource metadata with the exact resource and the issuer first", async () => {
    const meta = await (await fetch(`${hub.url}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(meta.resource).toBe(`${hub.url}/mcp`);
    expect(meta.authorization_servers[0]).toBe(`${hub.url}/api/auth`);
  });

  it.each(["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/auth"])(
    "publishes authorization server metadata at %s",
    async (path) => {
      const meta = await (await fetch(`${hub.url}${path}`)).json();
      expect(meta.issuer).toBe(`${hub.url}/api/auth`);
      expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
      expect(meta.client_id_metadata_document_supported).toBe(true);
      expect(meta.token_endpoint_auth_methods_supported).toContain("none");
      expect(meta.scopes_supported).toContain("offline_access");
    },
  );
});

describe("identity", () => {
  it("whoami works over MCP 2026-07-28 (v2 client) with team, role and handle", async () => {
    const client = await mcpClient(hub.url, team.sam.token);
    const who = WhoamiSchema.parse((await call(client, "whoami")).json());
    expect(who).toMatchObject({
      user: { name: "Sam" },
      auth: "personal_token",
      team: { name: "Acme web" },
      role: "member",
      handle: "sam",
      paused: false,
    });
    expect(who.agent?.id).toMatch(/^agt_/);
    await client.close();
  });

  it("whoami works over MCP 2025-11-25 with the initialize handshake (v1 client)", async () => {
    const client = new ClientV1({ name: "test-v1", version: "0" });
    await client.connect(
      new TransportV1(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${team.sam.token}` } } }),
    );
    const r = (await client.callTool({ name: "whoami", arguments: {} })) as { content: Array<{ text: string }> };
    expect(JSON.parse(r.content[0]?.text ?? "").handle).toBe("sam");
    await client.close();
  });

  it("serves whoami on REST and rejects unknown tokens", async () => {
    expect((await fetch(`${hub.url}/v1/whoami`)).status).toBe(401);
    expect((await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: "Bearer ctgh_unknown" } })).status).toBe(401);
    const res = await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${team.lea.token}` } });
    expect(WhoamiSchema.parse(await res.json())).toMatchObject({ role: "owner", handle: "lea" });
  });

  it("exposes exactly the hub tools, none of which runs commands", async () => {
    const client = await mcpClient(hub.url, team.sam.token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ack",
      "ask_peer",
      "claim",
      "claim_check",
      "claim_release",
      "handoff",
      "inbox_read",
      "memory_propose",
      "memory_search",
      "message_status",
      "send_message",
      "status_set",
      "task_claim",
      "task_create",
      "task_get",
      "task_list",
      "task_update",
      "team_overview",
      "whoami",
    ]);
    await client.close();
  });
});

describe("sign-up", () => {
  it("is refused for an invited email without the invitation token", async () => {
    await createInvitation(hub.db, { teamId: team.teamId, email: "nina@acme.test", role: "member", invitedBy: null, via: "system" });
    const res = await fetch(`${hub.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url },
      body: JSON.stringify({ name: "Mallory", email: "nina@acme.test", password: "mallory-password-1" }),
    });
    expect(res.ok).toBe(false);
    const wrong = await fetch(`${hub.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url, [INVITE_HEADER]: "not-the-token" },
      body: JSON.stringify({ name: "Mallory", email: "nina@acme.test", password: "mallory-password-1" }),
    });
    expect(wrong.ok).toBe(false);
  });

  it("accepts the invitation token and creates the membership", async () => {
    const { token } = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "omar@acme.test",
      role: "guest",
      invitedBy: null,
      via: "system",
    });
    const res = await fetch(`${hub.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url, [INVITE_HEADER]: token },
      body: JSON.stringify({ name: "Omar", email: "omar@acme.test", password: "omar-password-123" }),
    });
    expect(res.ok).toBe(true);
    const [m] = await hub.db.select().from(membership).where(eq(membership.handle, "omar"));
    expect(m?.role).toBe("guest");
  });

  it("joins only the team whose link was used, even when another team invited the same email", async () => {
    const hostile = await createTeam(hub.db, "Hostile");
    await createInvitation(hub.db, { teamId: hostile, email: "ines@acme.test", role: "admin", invitedBy: null, via: "system" });
    const { token } = await createInvitation(hub.db, {
      teamId: team.teamId,
      email: "ines@acme.test",
      role: "member",
      invitedBy: null,
      via: "system",
    });
    const res = await fetch(`${hub.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url, [INVITE_HEADER]: token },
      body: JSON.stringify({ name: "Ines", email: "ines@acme.test", password: "ines-password-123" }),
    });
    expect(res.ok).toBe(true);
    const { user } = (await res.json()) as { user: { id: string } };
    const teams = await hub.db.select().from(membership).where(eq(membership.userId, user.id));
    expect(teams.map((m) => m.teamId)).toEqual([team.teamId]);
    expect((await principalForUser(hub.db, user.id, "console"))?.teamId).toBe(team.teamId);
  });

  it("is refused without an invitation", async () => {
    await expect(
      hub.auth.api.signUpEmail({ body: { name: "Eve", email: "eve@evil.test", password: "eve-password-123" } }),
    ).rejects.toThrow();
    const res = await fetch(`${hub.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url },
      body: JSON.stringify({ name: "Eve", email: "eve@evil.test", password: "eve-password-123" }),
    });
    expect(res.ok).toBe(false);
  });
});

describe("audit chain", () => {
  it("is intact after the seed and detects a tampered event", async () => {
    expect(await verifyChain(hub.db, team.teamId)).toBeNull();
    const [first] = await hub.db.select().from(auditEvent).where(eq(auditEvent.teamId, team.teamId)).limit(1);
    if (!first) throw new Error("no audit event");
    await hub.db
      .update(auditEvent)
      .set({ data: { tampered: true } })
      .where(eq(auditEvent.seq, first.seq));
    expect(await verifyChain(hub.db, team.teamId)).toBe(first.seq);
    await hub.db.update(auditEvent).set({ data: first.data }).where(eq(auditEvent.seq, first.seq));
  });
});

describe("OAuth pages", () => {
  it("serve the login page under a self-only CSP", async () => {
    const res = await fetch(`${hub.url}/login`);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(await res.text()).not.toMatch(/<script>/);
  });
});
