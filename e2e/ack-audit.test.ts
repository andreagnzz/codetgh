import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, auditEvent } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("audits an ack with the channel it came through", async () => {
  const send = async (body: string) => {
    const res = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
      body: JSON.stringify({ to: "@lea", kind: "note", body, allow_offline: true }),
    });
    return ((await res.json()) as { id: string }).id;
  };
  const viaRest = await send("acked from the CLI");
  const viaMcp = await send("acked by the agent");

  const res = await fetch(`${hub.url}/v1/ack`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
    body: JSON.stringify({ message_ids: [viaRest] }),
  });
  expect(((await res.json()) as { acked: number }).acked).toBe(1);
  // A call that names no agent never gets the REST agent, the one that reads every receipt of the person: name it.
  const [rest] = await hub.db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.userId, team.lea.userId), like(agent.sessionId, "cli-%")));
  const lea = await mcpClient(hub.url, team.lea.token);
  expect((await call(lea, "ack", { agent: rest?.id, message_ids: [viaMcp] })).json()).toEqual({ acked: 1 });
  await lea.close();

  const acks = await hub.db
    .select({ via: auditEvent.via })
    .from(auditEvent)
    .where(and(eq(auditEvent.teamId, team.teamId), eq(auditEvent.action, "message.acked")))
    .orderBy(asc(auditEvent.seq));
  expect(acks.map((a) => a.via)).toEqual(["rest", "mcp"]);
});
