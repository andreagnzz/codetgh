import { get } from "node:http";
import { WhoamiSchema } from "@codetgh/shared";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as oauth from "oauth4webapi";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

// Replays the browser flow Claude Code runs on /mcp: DCR, PKCE S256, login, consent, code, refresh.
const REDIRECT = "http://127.0.0.1:33418/callback";
const insecure = { [oauth.allowInsecureRequests]: true };

let hub: Hub;
let BASE = "";
let RESOURCE = "";

beforeAll(async () => {
  hub = await startHub();
  await hub.seed();
  BASE = hub.url;
  RESOURCE = `${BASE}/mcp`;
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

it("lets an MCP client sign in as Léa and call whoami with the access token", async () => {
  const issuer = new URL(`${BASE}/api/auth`);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));

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

  const verifier = oauth.generateRandomCodeVerifier();
  const authorize = new URL(as.authorization_endpoint ?? "");
  authorize.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "openid offline_access",
    resource: RESOURCE,
    state: "s1",
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
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

  const params = oauth.validateAuthResponse(as, client, next, "s1");
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, REDIRECT, verifier, {
      additionalParameters: { resource: RESOURCE },
      ...insecure,
    }),
    { requireIdToken: false },
  );
  expect(tokens.refresh_token).toBeTypeOf("string");

  const mcp = new Client({ name: "oauth-test", version: "0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }),
  );
  const [first] = (await mcp.callTool({ name: "whoami", arguments: {} })).content as Array<{ text: string }>;
  expect(WhoamiSchema.parse(JSON.parse(first?.text ?? ""))).toMatchObject({ user: { name: "Léa" }, auth: "oauth", handle: "lea" });
  await mcp.close();

  const refreshed = await oauth.processRefreshTokenResponse(
    as,
    client,
    await oauth.refreshTokenGrantRequest(as, client, oauth.None(), tokens.refresh_token ?? "", {
      additionalParameters: { resource: RESOURCE },
      ...insecure,
    }),
  );
  expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

  // Reusing the rotated-out token within @better-auth/mcp's 30 s replay window returns the same response again
  // (a client whose answer got lost can retry); it never mints new tokens. After the window: invalid_grant.
  const reused = await oauth.processRefreshTokenResponse(
    as,
    client,
    await oauth.refreshTokenGrantRequest(as, client, oauth.None(), tokens.refresh_token ?? "", {
      additionalParameters: { resource: RESOURCE },
      ...insecure,
    }),
  );
  expect(reused.refresh_token).toBe(refreshed.refresh_token);
});
