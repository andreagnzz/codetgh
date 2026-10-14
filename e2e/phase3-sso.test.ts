import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvitation } from "../apps/hub/src/domain/teams.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

// A minimal OpenID provider: discovery, authorize, token, userinfo, JWKS, and it signs what it sends.
let idp: Server;
let issuer = "";
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const keys = await generateKeyPair("RS256");
const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
let nonce = "";
const SUB = "idp-user-nina";

const sign = (claims: Record<string, unknown>, key = keys.privateKey) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience("codetgh-client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

beforeAll(async () => {
  idp = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (v: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(v));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        backchannel_logout_supported: true,
      });
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/authorize") {
      nonce = url.searchParams.get("nonce") ?? "";
      res.statusCode = 302;
      res.setHeader("location", `${url.searchParams.get("redirect_uri")}?code=the-code&state=${url.searchParams.get("state")}`);
      return res.end();
    }
    if (url.pathname === "/token")
      return json({
        access_token: "idp-access",
        token_type: "Bearer",
        expires_in: 300,
        id_token: await sign({ sub: SUB, email: "nina@acme.test", email_verified: true, name: "Nina", ...(nonce && { nonce }) }),
      });
    if (url.pathname === "/userinfo") return json({ sub: SUB, email: "nina@acme.test", email_verified: true, name: "Nina" });
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => idp.listen(0, resolve));
  issuer = `http://localhost:${(idp.address() as AddressInfo).port}`;
  hub = await startHub({ config: { oidcIssuer: issuer, oidcClientId: "codetgh-client", oidcClientSecret: "client-secret" } });
  team = await hub.seed();
  await createInvitation(hub.db, {
    teamId: team.teamId,
    email: "nina@acme.test",
    role: "member",
    invitedBy: team.lea.userId,
    via: "system",
  });
});
afterAll(async () => {
  await hub.stop();
  idp.close();
});

// Follows the redirects of a sign-in by hand, carrying cookies like a browser.
async function ssoSignIn() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = (pair ?? "").split("=");
      if (k) jar.set(k, v ?? "");
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const start = await fetch(`${hub.url}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: hub.url },
    body: JSON.stringify({ provider: "sso", callbackURL: "/console" }),
  });
  keep(start);
  const { url } = (await start.json()) as { url: string };
  const atIdp = await fetch(url, { redirect: "manual" });
  const back = await fetch(atIdp.headers.get("location") ?? "", { redirect: "manual", headers: { cookie: cookie() } });
  keep(back);
  return cookie();
}

describe("SSO with the organization's OpenID provider (phase 3)", () => {
  let cookie = "";

  it("lets an invited person sign in through the identity provider", async () => {
    cookie = await ssoSignIn();
    const page = await fetch(`${hub.url}/console`, { headers: { cookie }, redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Acme web");
    expect(await (await fetch(`${hub.url}/login`)).text()).toContain("Sign in with your organization");
  });

  it("refuses a back-channel logout token it cannot verify", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await sign(
      { sub: SUB, jti: "j0", events: { "http://schemas.openid.net/event/backchannel-logout": {} } },
      other.privateKey,
    );
    const res = await fetch(`${hub.url}/sso/backchannel-logout`, { method: "POST", body: new URLSearchParams({ logout_token: forged }) });
    expect(res.status).toBe(400);
    expect((await fetch(`${hub.url}/console`, { headers: { cookie }, redirect: "manual" })).status).toBe(200);
  });

  it("closes the person's sessions when the provider says they are logged out", async () => {
    const token = await sign({ sub: SUB, jti: "j1", events: { "http://schemas.openid.net/event/backchannel-logout": {} } });
    const started = Date.now();
    expect(
      (await fetch(`${hub.url}/sso/backchannel-logout`, { method: "POST", body: new URLSearchParams({ logout_token: token }) })).status,
    ).toBe(200);
    const page = await fetch(`${hub.url}/console`, { headers: { cookie }, redirect: "manual" });
    expect(page.status).toBe(302);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
