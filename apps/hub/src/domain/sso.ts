import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { SSO_PROVIDER } from "../auth.js";
import type { Config } from "../config.js";
import { account, membership, oauthAccessToken, oauthRefreshToken, session } from "../db/schema.js";
import type { MessagingDeps } from "./messages.js";

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

async function providerKeys(issuer: string) {
  if (jwks?.issuer !== issuer) {
    const discovery = (await (await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) })).json()) as {
      jwks_uri?: string;
    };
    if (!discovery.jwks_uri) throw new Error("the provider publishes no jwks_uri");
    jwks = { issuer, set: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
  }
  return jwks.set;
}

// OpenID Connect Back-Channel Logout 1.0: a logout token signed by the provider, for this client, with the logout event
// and no nonce. Valid → every console session and OAuth grant of that person ends, and their live streams close.
export async function backchannelLogout(deps: MessagingDeps, config: Config, token: string) {
  if (!config.oidcIssuer || !config.oidcClientId || !token) return false;
  const { payload } = await jwtVerify(token, await providerKeys(config.oidcIssuer), {
    issuer: config.oidcIssuer,
    audience: config.oidcClientId,
    maxTokenAge: "10m",
  });
  const events = payload.events as Record<string, unknown> | undefined;
  if (!payload.sub || !events?.[LOGOUT_EVENT] || "nonce" in payload) return false;
  const { db, bus } = deps;
  const [acc] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, SSO_PROVIDER), eq(account.accountId, payload.sub)));
  // Unknown subject: nothing to close, and the provider must not learn who has an account here.
  if (!acc) return true;
  await db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.userId, acc.userId));
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, acc.userId));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, acc.userId));
  });
  for (const m of await db.select({ teamId: membership.teamId }).from(membership).where(eq(membership.userId, acc.userId)))
    bus.emit("revoked", { teamId: m.teamId, userId: acc.userId });
  return true;
}
