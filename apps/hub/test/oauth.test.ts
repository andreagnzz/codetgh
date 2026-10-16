import { get } from "node:http";
import { WhoamiSchema } from "@codetgh/shared";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as oauth from "oauth4webapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Hub, startHub } from "./harness.js";

// Replays the browser flow Claude Code runs on /mcp: discovery, CIMD or DCR, PKCE S256, login, consent, code, refresh.
const REDIRECT = "http://127.0.0.1:33418/callback";
const insecure = { [oauth.allowInsecureRequests]: true };

// A CIMD client: its client_id is the https URL of its metadata document, served here instead of the network.
const CIMD = vi.hoisted(() => ({
  id: "https://client.example/oauth/client-metadata.json",
  doc: {
    client_id: "https://client.example/oauth/client-metadata.json",
    client_name: "cimd-test",
    redirect_uris: ["http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
}));
vi.mock("@better-auth/cimd/node", () => ({
  fetchClientMetadataResource: async (input: RequestInfo | URL) =>
    String(input instanceof Request ? input.url : input) === CIMD.id
      ? Response.json(CIMD.doc, { headers: { "cache-control": "max-age=60" } })
      : new Response("not found", { status: 404 }),
}));

let hub: Hub;
let BASE = "";
let RESOURCE = "";
let as: oauth.AuthorizationServer;

beforeAll(async () => {
  hub = await startHub();
  await hub.seed();
  BASE = hub.url;
  RESOURCE = `${BASE}/mcp`;
  const issuer = new URL(`${BASE}/api/auth`);
  as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
});

afterAll(() => hub.stop());

// undici's fetch always sends sec-fetch-mode: cors, which better-auth answers with JSON; a browser navigates.
function navigate(url: URL) {
  return new Promise<{ status: number; location: string }>((resolve, reject) => {
    get(url, { headers: { accept: "text/html", "sec-fetch-mode": "navigate" } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? "" });
    }).on("error", reject);
  });
}

async function postJson(path: string, body: unknown, cookie = "") {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: BASE },
    body: JSON.stringify(body),
  });
  return { res, data: (await res.json()) as Record<string, string> };
}

function authorizeUrl(client: oauth.Client, params: Record<string, string>) {
  const url = new URL(as.authorization_endpoint ?? "");
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: REDIRECT, response_type: "code", ...params }).toString();
  return url;
}

// Login as Léa and accept the consent screen; returns the callback URL the browser lands on.
async function signInAndConsent(authorize: URL) {
  const toLogin = await navigate(authorize);
  expect(toLogin.status).toBe(302);
  const loginUrl = new URL(toLogin.location, BASE);
  expect(loginUrl.pathname).toBe("/login");
  const signIn = await postJson("/api/auth/sign-in/email", {
    email: "lea@acme.test",
    password: "lea-password-123",
    oauth_query: loginUrl.search.slice(1),
  });
  const cookie = (signIn.res.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
  let next = new URL(signIn.data.url ?? "", BASE);
  if (next.pathname === "/consent") {
    next = new URL(
      (await postJson("/api/auth/oauth2/consent", { accept: true, oauth_query: next.search.slice(1) }, cookie)).data.url ?? "",
    );
  }
  expect(`${next.origin}${next.pathname}`).toBe(REDIRECT);
  return next;
}

async function login(client: oauth.Client, scope: string) {
  const verifier = oauth.generateRandomCodeVerifier();
  const callback = await signInAndConsent(
    authorizeUrl(client, {
      scope,
      resource: RESOURCE,
      state: "s1",
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    }),
  );
  // RFC 9207: the authorization response names the issuer; validateAuthResponse requires it when advertised.
  expect(callback.searchParams.get("iss")).toBe(as.issuer);
  const params = oauth.validateAuthResponse(as, client, callback, "s1");
  return oauth.processAuthorizationCodeResponse(
    as,
    client,
    await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, REDIRECT, verifier, {
      additionalParameters: { resource: RESOURCE },
      ...insecure,
    }),
    { requireIdToken: false },
  );
}

async function whoami(accessToken: string) {
  const mcp = new Client({ name: "oauth-test", version: "0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }),
  );
  const [first] = (await mcp.callTool({ name: "whoami", arguments: {} })).content as Array<{ text: string }>;
  await mcp.close();
  return WhoamiSchema.parse(JSON.parse(first?.text ?? ""));
}

const initialize = (accessToken: string) =>
  fetch(RESOURCE, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;

describe("MCP authorization 2026-07-28", () => {
  const cimdClient: oauth.Client = { client_id: CIMD.id, token_endpoint_auth_method: "none" };

  it("challenges with the protected resource metadata and the codetgh scope", async () => {
    const res = await fetch(RESOURCE, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="codetgh"');
    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: [as.issuer], scopes_supported: ["codetgh"] });
  });

  it("publishes RFC 8414 and OIDC discovery with PKCE S256, CIMD and RFC 9207", async () => {
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.scopes_supported).toEqual(expect.arrayContaining(["codetgh", "offline_access"]));
    const oidc = await (await fetch(`${BASE}/api/auth/.well-known/openid-configuration`)).json();
    expect(oidc.issuer).toBe(as.issuer);
  });

  it("refuses an authorization request without PKCE", async () => {
    const res = await navigate(authorizeUrl(cimdClient, { scope: "codetgh", resource: RESOURCE, state: "s1" }));
    const target = new URL(res.location, BASE);
    expect(target.searchParams.get("error")).toBe("invalid_request");
  });

  it("signs a CIMD client in, binds the token to /mcp and serves whoami", async () => {
    const tokens = await login(cimdClient, "codetgh offline_access");
    expect(claims(tokens.access_token)).toMatchObject({ aud: RESOURCE, azp: CIMD.id });
    expect(String(claims(tokens.access_token).scope).split(" ")).toContain("codetgh");
    expect(await whoami(tokens.access_token)).toMatchObject({ user: { name: "Léa" }, auth: "oauth", handle: "lea" });
  });

  it("refuses a token signed by the hub for another audience", async () => {
    const tokens = await login(cimdClient, "codetgh");
    const sign = async (aud: string) => (await hub.auth.api.signJWT({ body: { payload: { ...claims(tokens.access_token), aud } } })).token;
    // Control: the same claims re-signed for /mcp pass, so only the audience differs below.
    expect((await initialize(await sign(RESOURCE))).status).toBe(200);
    const res = await initialize(await sign("https://other.example/mcp"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("answers 403 insufficient_scope to a token without the codetgh scope", async () => {
    const tokens = await login(cimdClient, "openid offline_access");
    const res = await initialize(tokens.access_token);
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="codetgh"');
    expect(challenge).toContain("resource_metadata=");
  });

  it("still registers a DCR client, then rotates its refresh token", async () => {
    const registration = await postJson(new URL(as.registration_endpoint ?? "").pathname, {
      client_name: "phase0-test",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
    });
    expect(registration.res.status, JSON.stringify(registration.data)).toBe(201);
    const client: oauth.Client = { client_id: registration.data.client_id ?? "", token_endpoint_auth_method: "none" };
    const tokens = await login(client, "codetgh offline_access");
    expect(tokens.refresh_token).toBeTypeOf("string");
    expect(await whoami(tokens.access_token)).toMatchObject({ user: { name: "Léa" }, auth: "oauth" });

    const refresh = () =>
      oauth.refreshTokenGrantRequest(as, client, oauth.None(), tokens.refresh_token ?? "", {
        additionalParameters: { resource: RESOURCE },
        ...insecure,
      });
    const refreshed = await oauth.processRefreshTokenResponse(as, client, await refresh());
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect(await whoami(refreshed.access_token)).toMatchObject({ auth: "oauth" });

    // Reusing the rotated-out token within @better-auth/mcp's 30 s replay window returns the same response again
    // (a client whose answer got lost can retry); it never mints new tokens. After the window: invalid_grant.
    const reused = await oauth.processRefreshTokenResponse(as, client, await refresh());
    expect(reused.refresh_token).toBe(refreshed.refresh_token);
  });
});
