import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { team as teamTable } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, code, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  for (const [p, s] of [
    [team.lea, "lea-sc"],
    [team.sam, "sam-sc"],
    [team.malik, "malik-sc"],
  ] as const)
    await startSession(hub.url, p.token, s, { repo: ACME_REPO });
});
afterAll(() => hub.stop());

it("never lets an agent accept its own person's memory proposal", async () => {
  await hub.db
    .update(teamTable)
    .set({ settings: { memory_accept_via_mcp: true } })
    .where(eq(teamTable.id, team.teamId));
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  const proposed = JSON.parse((await call(sam, "memory_propose", { kind: "decision", title: "Ship on Friday", body: "b" })).text);
  expect(code(await call(sam, "memory_accept", { item_id: proposed.id, decision: "accept" }))).toBe("E_FORBIDDEN");
  // Someone else may.
  expect(code(await call(lea, "memory_accept", { item_id: proposed.id, decision: "accept" }))).toBeNull();
});

it("refuses ciphertext from an MCP client: encryption happens in the CLI, which scans before sealing", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const sealed = `v1.${"A".repeat(16)}.${Buffer.from("AWS_SECRET=abc").toString("base64url")}.${"A".repeat(22)}`;
  const r = await call(sam, "send_message", { to: "@lea", kind: "note", body: sealed, encrypted: { keys: [], flags: [] } });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/codetgh send --encrypt/);
});

it("does not let an agent take a task assigned to someone else", async () => {
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  const t = JSON.parse((await call(lea, "task_create", { title: "for Malik", assignee: "@malik" })).text);
  expect(code(await call(sam, "task_claim", { task_id: t.id, expected_version: t.version }))).not.toBeNull();
  expect(code(await call(malik, "task_claim", { task_id: t.id, expected_version: t.version }))).toBeNull();
});
