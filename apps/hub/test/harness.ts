import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { repoFingerprint } from "@codetgh/shared/repo";
import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import pg from "pg";
import { pino } from "pino";
import { ulid } from "ulid";
import { createApp } from "../src/app.js";
import { type Auth, createAuth, INVITE_HEADER } from "../src/auth.js";
import type { Config } from "../src/config.js";
import { type Db, openDb } from "../src/db/index.js";
import { project } from "../src/db/schema.js";
import type { RateLimiter } from "../src/domain/limits.js";
import { createInvitation, createTeam } from "../src/domain/teams.js";
import { newId } from "../src/ids.js";
import type { Mailer } from "../src/mailer.js";
import { createPersonalToken } from "../src/tokens.js";

// Generated per run: the repository holds no fixed hub secret, even for tests.
const SECRET = randomBytes(32).toString("base64");

// Real hub on a random port; PGlite in memory, or a fresh database on TEST_DATABASE_URL.
export async function startHub(opts: { limiter?: RateLimiter; logLines?: string[]; mailer?: Mailer; config?: Partial<Config> } = {}) {
  let app: ReturnType<typeof createApp> | undefined;
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ port: 0, fetch: (req, env) => (app ? app.fetch(req, env) : new Response("starting", { status: 503 })) }, () =>
      resolve(s as Server),
    );
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  let databaseUrl: string | undefined;
  let dropDb = async () => {};
  if (process.env.TEST_DATABASE_URL) {
    const name = `t_${ulid().toLowerCase()}`;
    const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.pathname = `/${name}`;
    databaseUrl = u.toString();
    dropDb = async () => {
      const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    };
  }
  const config: Config = {
    publicUrl: url,
    secret: SECRET,
    dataDir: "memory://",
    databaseUrl,
    distDir: "dist",
    publicDir: fileURLToPath(new URL("../public", import.meta.url)),
    brandDir: fileURLToPath(new URL("../../../assets/brand", import.meta.url)),
    port,
    host: "127.0.0.1",
    ...opts.config,
  };
  const template = process.env.CODETGH_TEST_PGLITE_TEMPLATE;
  const { db, close, pglite } = await openDb({
    ...config,
    loadDataDir: template && !databaseUrl ? new Blob([readFileSync(template)]) : undefined,
  });
  const auth = createAuth(config, db, opts.mailer);
  app = createApp({
    config,
    db,
    auth,
    limiter: opts.limiter,
    logger: opts.logLines ? pino({}, { write: (line: string) => void opts.logLines?.push(line) }) : pino({ level: "silent" }),
    mailer: opts.mailer,
  });
  const hub = { url, db, auth, app, bus: app.bus, pglite, config };

  async function stop() {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await close();
    await dropDb();
  }
  return { ...hub, stop, seed: () => seedTeam(hub) };
}

export type Hub = Awaited<ReturnType<typeof startHub>>;

const PEOPLE = [
  { key: "lea", name: "Léa", email: "lea@acme.test", role: "owner" },
  { key: "sam", name: "Sam", email: "sam@acme.test", role: "member" },
  { key: "malik", name: "Malik", email: "malik@acme.test", role: "member" },
] as const;

// "Acme web" with Léa (owner), Sam and Malik, created through the real invitation path.
async function seedTeam(hub: { db: Db; auth: Auth }) {
  const teamId = await createTeam(hub.db, "Acme web");
  const people = {} as Record<(typeof PEOPLE)[number]["key"], Person>;
  for (const p of PEOPLE) {
    const invite = await createInvitation(hub.db, { teamId, email: p.email, role: p.role, invitedBy: null, via: "system" });
    const password = `${p.key}-password-123`;
    const { user } = await hub.auth.api.signUpEmail({
      body: { name: p.name, email: p.email, password },
      headers: new Headers({ [INVITE_HEADER]: invite.token }),
    });
    const { token } = await createPersonalToken(hub.db, { userId: user.id, teamId, label: `${p.key} laptop` });
    const res = await hub.auth.api.signInEmail({ body: { email: p.email, password }, asResponse: true });
    const cookie = res.headers
      .getSetCookie()
      .map((c: string) => c.split(";")[0])
      .join("; ");
    people[p.key] = { userId: user.id, name: p.name, email: p.email, password, token, cookie, handle: p.key };
  }
  // The repositories the tests use, linked as codetgh project new would: unknown ones stay off the hub.
  for (const repo of ["webapp", "billing", "api", "latency", "ops"])
    await hub.db.insert(project).values({
      id: newId("prj"),
      teamId,
      name: `acme/${repo}`,
      repoFingerprint: repoFingerprint(`git@github.com:acme/${repo}.git`),
    });
  await hub.db.insert(project).values({ id: newId("prj"), teamId, name: "acme", repoFingerprint: ACME_REPO });
  return { teamId, ...people };
}

export type Person = { userId: string; name: string; email: string; password: string; token: string; cookie: string; handle: string };

export async function mcpClient(url: string, token: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  return client;
}

// Agents in the same repository share a project through the fingerprint of their git origin.
export const ACME_REPO = "a".repeat(64);

export async function startSession(url: string, token: string, sessionId: string, opts: { repo?: string; branch?: string } = {}) {
  const res = await fetch(`${url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      branch: opts.branch ?? "main",
      repo_fingerprint: opts.repo,
      repo_name: opts.repo && "acme/webapp",
    }),
  });
  return (await res.json()) as { agent_id: string | null; paused: boolean; context: string };
}

// Tool results are one text block; errors carry {code, message}.
export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  const text = r.content[0]?.text ?? "";
  return { text, isError: Boolean(r.isError), json: () => JSON.parse(text.split("\n\n")[0] ?? "null") };
}
