// Load test from SPEC « Stratégie de test »: 50 agents, 2 messages per minute each, LOAD_SECONDS long (default 600).
// Run: npx tsx e2e/load.ts   (in-process hub on PGlite, or TEST_DATABASE_URL for Postgres)
import { INVITE_HEADER } from "../apps/hub/src/auth.js";
import { createInvitation, createTeam } from "../apps/hub/src/domain/teams.js";
import { createPersonalToken } from "../apps/hub/src/tokens.js";
import { call, mcpClient, startHub } from "../apps/hub/test/harness.js";

const AGENTS = Number(process.env.LOAD_AGENTS ?? 50);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 600);
const PER_MINUTE = 2;

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

const hub = await startHub();
const teamId = await createTeam(hub.db, "Load");
const clients = [];
for (let i = 0; i < AGENTS; i++) {
  const email = `agent${i}@load.test`;
  const { token: invite } = await createInvitation(hub.db, { teamId, email, role: "member", invitedBy: null, via: "system" });
  const { user } = await hub.auth.api.signUpEmail({
    body: { name: `Agent ${i}`, email, password: `agent-${i}-password` },
    headers: new Headers({ [INVITE_HEADER]: invite }),
  });
  const { token } = await createPersonalToken(hub.db, { userId: user.id, teamId, label: "load" });
  clients.push(await mcpClient(hub.url, token));
}

const send: number[] = [];
const read: number[] = [];
let errors = 0;
const deadline = Date.now() + SECONDS * 1000;
await Promise.all(
  clients.map(async (client, i) => {
    await new Promise((r) => setTimeout(r, Math.random() * 30_000));
    while (Date.now() < deadline) {
      let t = performance.now();
      const r = await call(client, "send_message", { to: `@agent-${(i + 1) % AGENTS}`, kind: "note", body: `status update ${Date.now()}` });
      send.push(performance.now() - t);
      if (r.isError) errors++;
      t = performance.now();
      await call(client, "inbox_read", { limit: 20 });
      read.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 60_000 / PER_MINUTE));
    }
  }),
);
console.log(
  JSON.stringify({
    agents: AGENTS,
    seconds: SECONDS,
    sends: send.length,
    errors,
    send_p95_ms: Math.round(p95(send)),
    inbox_read_p95_ms: Math.round(p95(read)),
  }),
);
await Promise.all(clients.map((c) => c.close()));
await hub.stop();
