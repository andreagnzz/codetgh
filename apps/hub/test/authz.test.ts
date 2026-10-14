import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent } from "../src/db/schema.js";
import { call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const code = (r: { text: string }) => JSON.parse(r.text).code;

describe("direct threads stay between their participants", () => {
  it("refuses to reply into or address someone else's DM, and allows team threads", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    const malik = await mcpClient(hub.url, team.malik.token);
    const dm = JSON.parse((await call(sam, "send_message", { to: "@lea", kind: "question", body: "privé" })).text);
    expect(code(await call(malik, "send_message", { kind: "answer", reply_to: dm.id, body: "faux" }))).toBe("E_NOT_FOUND");
    expect(code(await call(malik, "send_message", { kind: "note", to: `thread:${dm.thread}`, body: "x" }))).toBe("E_NOT_FOUND");
    const html = await (await fetch(`${hub.url}/console/threads/${dm.thread}`, { headers: { cookie: team.malik.cookie } })).text();
    expect(html).not.toContain("privé");

    const all = JSON.parse((await call(sam, "send_message", { to: "@team", kind: "note", body: "déploiement à 17 h" })).text);
    expect((await call(malik, "send_message", { kind: "note", reply_to: all.id, body: "ok" })).isError).toBe(false);
    await sam.close();
    await malik.close();
  });

  it("hides the audit feed, which lists message ids, from members", async () => {
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie: team.malik.cookie } })).text();
    expect(html).not.toContain("Recent activity");
  });
});

describe("status and notes", () => {
  it("blocks secrets in status_set and ack notes", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const key = `ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}`;
    expect(code(await call(lea, "status_set", { text: `deploying with ${key}` }))).toBe("E_SECRET_BLOCKED");
    expect(code(await call(lea, "ack", { message_ids: [`msg_${"0".repeat(26)}`], note: key }))).toBe("E_SECRET_BLOCKED");
    await lea.close();
  });

  it("refuses status updates from a quarantined agent", async () => {
    const { agent_id } = await startSession(hub.url, team.malik.token, "malik-q");
    await hub.db
      .update(agent)
      .set({ trustLevel: "quarantined" })
      .where(eq(agent.id, agent_id ?? ""));
    const malik = await mcpClient(hub.url, team.malik.token);
    expect(code(await call(malik, "status_set", { agent: agent_id, text: "hello" }))).toBe("E_FORBIDDEN");
    await malik.close();
  });
});

describe("rate limit", () => {
  it("does not reset when an agent opens new sessions", async () => {
    const results = [];
    for (let i = 0; i < 12; i++) {
      const { agent_id } = await startSession(hub.url, team.sam.token, `burst-${i}`);
      const sam = await mcpClient(hub.url, team.sam.token);
      results.push((await call(sam, "send_message", { agent: agent_id, to: "@lea", kind: "note", body: `n${i}` })).text);
      await sam.close();
    }
    expect(results.filter((t) => t.includes("E_RATE_LIMITED")).length).toBeGreaterThan(0);
  });
});
