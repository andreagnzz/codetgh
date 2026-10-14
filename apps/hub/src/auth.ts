import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, jwt, magicLink } from "better-auth/plugins";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { acceptInvitations, hasPendingInvitation, invitationMatches } from "./domain/teams.js";
import { newId } from "./ids.js";
import type { Mailer } from "./mailer.js";

export function createAuth(
  config: Pick<Config, "publicUrl" | "secret" | "oidcIssuer" | "oidcClientId" | "oidcClientSecret">,
  db?: Db,
  mailer?: Mailer,
) {
  return betterAuth({
    baseURL: config.publicUrl,
    secret: config.secret,
    database: db ? drizzleAdapter(db, { provider: "pg" }) : undefined,
    // Email + password stays for local development (human decision); GitHub and Google when configured.
    emailAndPassword: { enabled: true },
    session: { expiresIn: 12 * 3600, updateAge: 3600 },
    socialProviders: {
      ...(process.env.AUTH_GITHUB_ID && {
        github: { clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET ?? "" },
      }),
      ...(process.env.AUTH_GOOGLE_ID && {
        google: { clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "" },
      }),
    },
    advanced: { database: { generateId: ({ model }) => newId(ID_PREFIX[model] ?? model.slice(0, 4).toLowerCase()) } },
    // Sign-up is invitation-only: a password sign-up must carry the invitation token (X-CodeTgh-Invite);
    // a social sign-up needs an email the provider has verified.
    databaseHooks: db && {
      user: {
        create: {
          before: async (u, ctx) => {
            const invite = ctx?.headers?.get(INVITE_HEADER);
            if (invite) return (await invitationMatches(db, invite, u.email)) || false;
            return (u.emailVerified && (await hasPendingInvitation(db, u.email))) || false;
          },
          after: async (u) => acceptInvitations(db, u),
        },
      },
    },
    plugins: [
      jwt(),
      // A magic link proves the email, so the invitation-only rule above applies unchanged.
      magicLink({
        expiresIn: 600,
        sendMagicLink: async ({ email, url }) => {
          await mailer?.send({
            to: email,
            subject: "Your CodeTgh sign-in link",
            text: `Sign in to CodeTgh (valid 10 minutes):\n${url}\n\nIf you did not ask for it, ignore this email.`,
          });
        },
      }),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: `${config.publicUrl}/mcp`,
        scopes: ["openid", "profile", "email", "offline_access"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      // SSO: the provider proves the email; the invitation-only rule above still decides who gets in.
      ...(config.oidcIssuer && config.oidcClientId
        ? [
            genericOAuth({
              config: [
                {
                  providerId: SSO_PROVIDER,
                  discoveryUrl: `${config.oidcIssuer}/.well-known/openid-configuration`,
                  clientId: config.oidcClientId,
                  clientSecret: config.oidcClientSecret,
                  scopes: ["openid", "email", "profile"],
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
    ],
  });
}

export const INVITE_HEADER = "x-codetgh-invite";
export const SSO_PROVIDER = "sso";
const ID_PREFIX: Record<string, string> = { user: "usr", session: "ses", account: "acc", verification: "ver" };

export type Auth = ReturnType<typeof createAuth>;
