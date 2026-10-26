export type Config = {
  publicUrl: string;
  secret: string;
  dataDir: string;
  databaseUrl?: string;
  smtpUrl?: string;
  mailFrom?: string;
  auditKey?: string;
  slackBotToken?: string;
  slackSigningSecret?: string;
  slackApiUrl?: string;
  // SSO: the organization's OpenID provider (issuer URL, client registered there).
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  // Built plugin.zip and codetgh-cli.tgz (pnpm build), served to members.
  distDir: string;
  // Favicons, manifest, console.css and fonts (apps/hub/public), and the brand kit (assets/brand).
  publicDir: string;
  brandDir: string;
  port: number;
  // The reverse proxy's own address: only its X-Forwarded-For is believed (per-address limits).
  trustedProxy?: string;
  // Loopback unless HOST says otherwise: the container sets 0.0.0.0, its published port stays on 127.0.0.1.
  host: string;
};

export function loadConfig(env = process.env): Config {
  const secret = env.CODETGH_SECRET;
  if (!secret) throw new Error("CODETGH_SECRET is required (32 random bytes, base64)");
  return {
    publicUrl: (env.CODETGH_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    secret,
    dataDir: env.CODETGH_DATA_DIR ?? "./data",
    databaseUrl: env.DATABASE_URL,
    smtpUrl: env.SMTP_URL,
    mailFrom: env.MAIL_FROM || undefined,
    auditKey: env.CODETGH_AUDIT_KEY,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    slackApiUrl: env.SLACK_API_URL,
    oidcIssuer: env.OIDC_ISSUER?.replace(/\/$/, ""),
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret: env.OIDC_CLIENT_SECRET,
    distDir: env.CODETGH_DIST_DIR ?? "dist",
    publicDir: env.CODETGH_PUBLIC_DIR ?? "public",
    brandDir: env.CODETGH_BRAND_DIR ?? "../../assets/brand",
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    trustedProxy: env.CODETGH_TRUSTED_PROXY,
  };
}
