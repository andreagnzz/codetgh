import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

// SPEC « claude.ai et autres clients »: what Claude's OAuth client checks, row by row. The real connector run is P5.
let hub: Hub;
beforeAll(async () => {
  hub = await startHub();
});
afterAll(() => hub.stop());

const json = async (path: string) => (await fetch(`${hub.url}${path}`)).json();

describe("claude.ai connector checklist", () => {
  it("answers a request without a token with 401 and the resource metadata URL", async () => {
    const res = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer .*resource_metadata="[^"]+"/);
  });

  it("publishes the protected resource with the URL entered and the hub's issuer first", async () => {
    const meta = await json("/.well-known/oauth-protected-resource/mcp");
    expect(meta.resource).toBe(`${hub.url}/mcp`);
    expect(meta.authorization_servers[0]).toBe(`${hub.url}/api/auth`);
  });

  it("publishes authorization server metadata that Claude accepts", async () => {
    const as = await json("/.well-known/oauth-authorization-server/api/auth");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    // No DCR: claude.ai identifies with its client metadata document (CIMD).
    expect(as.registration_endpoint).toBeUndefined();
    expect(as.scopes_supported).toContain("offline_access");
  });

  it("refuses DCR for claude.ai's callback and still shows its host on the consent screen", async () => {
    const res = await fetch(`${hub.url}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url },
      body: JSON.stringify({
        client_name: "claude.ai",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const consent = await (
      await fetch(
        `${hub.url}/consent?client_id=x&scope=openid&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}`,
      )
    ).text();
    expect(consent).toContain("claude.ai");
  });

  it("answers discovery well under 10 seconds", async () => {
    const started = Date.now();
    await json("/.well-known/oauth-authorization-server/api/auth");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
