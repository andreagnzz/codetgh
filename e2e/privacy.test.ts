import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, claim, task, user } from "../apps/hub/src/db/schema.js";
import { verifyChain } from "../apps/hub/src/domain/audit.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const MARKER = "marqueur-prive-de-sam-42";
let samTask = "";
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-priv", { repo: ACME_REPO });
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(sam, "send_message", { to: "@lea", kind: "note", body: `note de Sam ${MARKER}` });
  await call(lea, "send_message", { to: "@sam", kind: "note", body: "réponse de Léa à Sam" });
  await call(lea, "send_message", { to: "@malik", kind: "note", body: "message privé Léa → Malik" });
  await call(sam, "claim", { scope: ["api/sam.ts"] });
  const t = JSON.parse((await call(sam, "task_create", { title: "Tâche de Sam" })).text);
  await call(sam, "task_claim", { task_id: t.id, expected_version: 1 });
  samTask = t.id;
  for (const c of [sam, lea, malik]) await c.close();
});
afterAll(() => hub.stop());

describe("my data", () => {
  it("exports a member's own data, and nothing about others' conversations", async () => {
    const res = await fetch(`${hub.url}/console/me/export`, { headers: { cookie: team.sam.cookie } });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const data = await res.json();
    expect(data.profile).toMatchObject({ name: "Sam", email: "sam@acme.test" });
    expect(JSON.stringify(data.messages_sent)).toContain(MARKER);
    expect(JSON.stringify(data.messages_received)).toContain("réponse de Léa à Sam");
    expect(JSON.stringify(data)).not.toContain("message privé Léa → Malik");
    expect(data.claims[0]).toMatchObject({ scope: "api/sam.ts" });
    expect(data.tasks.map((t: { id: string }) => t.id)).toContain(samTask);
    expect(data.audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(data.tokens)).not.toMatch(/ctgh_|"hash"/);
  });

  it("erases a member on request, keeps the threads and the audit chain intact", async () => {
    expect((await consolePost(hub.url, team.sam.cookie, "/console/me/erase", { confirm: "no" })).status).toBe(400);
    expect((await consolePost(hub.url, team.sam.cookie, "/console/me/erase", { confirm: "erase" })).status).toBeLessThan(400);

    expect((await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${team.sam.token}` } })).status).toBe(401);
    const [u] = await hub.db.select().from(user).where(eq(user.id, team.sam.userId));
    expect(u).toMatchObject({ name: "Former member" });
    expect(u?.email).not.toContain("sam@acme.test");

    // Neither the email nor the private text survives in any text column.
    const dump = await hub.db.execute(sql`
      select string_agg(t::text, ' ') as all_text from (
        select row_to_json(m)::text as t from message m
        union all select row_to_json(u)::text from "user" u
        union all select row_to_json(i)::text from invitation i
        union all select row_to_json(a)::text from alert a
        union all select row_to_json(e)::text from audit_event e
      ) x`);
    const text = String((dump as unknown as { rows: Array<{ all_text: string }> }).rows[0]?.all_text ?? "");
    expect(text).not.toContain("sam@acme.test");
    expect(text).not.toContain(MARKER);

    const thread = await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.lea.cookie } })).text();
    expect(thread).toContain("thr_");
    const claims = await hub.db.select().from(claim).where(eq(claim.holderUserId, team.sam.userId));
    expect(claims.every((c) => c.releaseReason === "erased")).toBe(true);
    const [t] = await hub.db.select().from(task).where(eq(task.id, samTask));
    expect(t).toMatchObject({ status: "todo", assigneeUserId: null });

    expect(await verifyChain(hub.db, team.teamId)).toBeNull();
    expect(await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "member.erased"))).toHaveLength(1);
  });

  it("refuses to erase the only owner", async () => {
    expect((await consolePost(hub.url, team.lea.cookie, "/console/me/erase", { confirm: "erase" })).status).toBe(403);
  });
});
