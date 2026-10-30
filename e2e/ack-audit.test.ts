import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, auditEvent } from "../apps/hub/src/db/schema.js";
import { callOnce, type Hub, startHub } from "../apps/hub/test/harness.js";
import { hubRest } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("audits an ack with the channel it came through", async () => {
  const send = async (body: string) => {
    const res = await hubRest(hub.url, team.sam.token, "POST", "/v1/messages", { to: "@lea", kind: "note", body, allow_offline: true });
    return ((await res.json()) as { id: string }).id;
  };
  const viaRest = await send("acked from the CLI");
  const viaMcp = await send("acked by the agent");

  const res = await hubRest(hub.url, team.lea.token, "POST", "/v1/ack", { message_ids: [viaRest] });
  expect(((await res.json()) as { acked: number }).acked).toBe(1);
  // A call that names no agent never gets the REST agent, the one that reads every receipt of the person: name it.
  const [rest] = await hub.db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.userId, team.lea.userId), like(agent.sessionId, "cli-%")));
  expect((await callOnce(hub.url, team.lea.token, "ack", { agent: rest?.id, message_ids: [viaMcp] })).json()).toEqual({ acked: 1 });

  const acks = await hub.db
    .select({ via: auditEvent.via })
    .from(auditEvent)
    .where(and(eq(auditEvent.teamId, team.teamId), eq(auditEvent.action, "message.acked")))
    .orderBy(asc(auditEvent.seq));
  expect(acks.map((a) => a.via)).toEqual(["rest", "mcp"]);
});
