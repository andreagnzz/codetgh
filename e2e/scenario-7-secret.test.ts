import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { alert, auditEvent } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost, fakeGithubToken, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("blocks a fake API key on the workstation and on the hub, and never stores it (scenario 7)", async () => {
  const key = fakeGithubToken();
  const hook = await runHook(
    "pre-tool-use",
    {
      session_id: "s7",
      tool_name: "mcp__plugin_codetgh_hub__send_message",
      tool_input: { to: "@lea", kind: "note", body: `voici la clé ${key}` },
    },
    hookEnv(hub.url, team.sam.token),
  );
  const out = hook.out?.hookSpecificOutput as { permissionDecision: string; permissionDecisionReason: string };
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toContain("ghp_…****");
  expect(out.permissionDecisionReason).not.toContain(key);

  // A client that skips the hook hits the hub check.
  const sam = await mcpClient(hub.url, team.sam.token);
  const r = await call(sam, "send_message", { to: "@lea", kind: "note", body: `voici la clé ${key}` });
  expect(r.isError).toBe(true);
  expect(JSON.parse(r.text).code).toBe("E_SECRET_BLOCKED");
  expect(r.text).not.toContain(key);

  const [a] = await hub.db.select().from(alert).where(eq(alert.kind, "secret_blocked"));
  expect(a?.excerpt).toBe("ghp_…****");
  expect((await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "message.blocked"))).length).toBe(1);
  const page = await (await fetch(`${hub.url}/console/alerts`, { headers: { cookie: team.lea.cookie } })).text();
  expect(page).toContain("ghp_…****");
  expect(page).not.toContain(key);

  // Nowhere in the database files.
  const dump = await hub.pglite?.dumpDataDir("none");
  if (dump) expect(Buffer.from(await dump.arrayBuffer()).includes(key)).toBe(false);

  // A team pattern is enforced too.
  expect(
    (await consolePost(hub.url, team.lea.cookie, "/console/settings", { secret_patterns: "ACME-[0-9]{6}", retention_days: "90" })).status,
  ).toBeLessThan(400);
  const custom = await call(sam, "send_message", { to: "@lea", kind: "note", body: "client ACME-123456" });
  expect(JSON.parse(custom.text).code).toBe("E_SECRET_BLOCKED");
  await sam.close();
});
