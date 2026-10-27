import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, auditEvent, claim, membership, team as teamTable } from "../src/db/schema.js";
import { compat } from "../src/domain/claims.js";
import { ACME_REPO, call, code, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const sessions: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  for (const who of ["lea", "sam", "malik"] as const) {
    sessions[who] = (await startSession(hub.url, team[who].token, `${who}-claims`, { repo: ACME_REPO })).agent_id ?? "";
  }
});
afterAll(() => hub.stop());

const preEdit = async (token: string, sessionId: string, path: string) => {
  const res = await fetch(`${hub.url}/v1/claims/pre-edit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, path }),
  });
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { decision: string; reason: string }) : null };
};
const active = (agentId: string) =>
  hub.db
    .select()
    .from(claim)
    .where(and(eq(claim.holderAgentId, agentId), isNull(claim.releasedAt)));

describe("compatibility matrix (SPEC « Réservations »)", () => {
  it.each([
    ["exclusive", "exclusive", "conflict"],
    ["exclusive", "intent", "warn"],
    ["exclusive", "shared", "notify"],
    ["intent", "exclusive", "conflict"],
    ["intent", "intent", "warn"],
    ["intent", "shared", "notify"],
    ["shared", "exclusive", "ok"],
    ["shared", "intent", "ok"],
    ["shared", "shared", "ok"],
  ] as const)("requested %s on held %s → %s", (requested, held, expected) => {
    expect(compat(requested, held)).toBe(expected);
  });
});

describe("claims", () => {
  it("lets one agent hold a file exclusively and tells others who holds it", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const sam = await mcpClient(hub.url, team.sam.token);
    const r = await call(lea, "claim", { scope: ["api/users.ts"], mode: "exclusive", reason: "refonte du contrat /users" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).claims[0].id).toMatch(/^clm_/);

    const conflict = await call(sam, "claim", { scope: ["api/users.ts"] });
    expect(code(conflict)).toBe("E_CLAIM_CONFLICT");
    expect(conflict.text).toContain("held by @lea (exclusive");

    const checked = await call(sam, "claim_check", { paths: ["api/users.ts", "api/free.ts"] });
    const check = checked.json();
    expect(check.paths[0]).toMatchObject({ path: "api/users.ts", holders: [{ handle: "lea", mode: "exclusive" }] });
    // The reason is a peer's words: shown in an envelope, never as a bare JSON field.
    expect(check.paths[0]?.holders[0]).not.toHaveProperty("reason");
    expect(checked.text).toMatch(/<peer_message[^>]*kind="claim"[^>]*trust="untrusted-peer">[\s\S]*refonte du contrat \/users/);
    expect(check.paths[0].holders[0].remaining_min).toBeGreaterThanOrEqual(29);
    expect(check.paths[1].holders).toEqual([]);
    expect(await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "claim.created"))).not.toHaveLength(0);
    await lea.close();
    await sam.close();
  });

  it("answers the edit hook: ask on someone else's exclusive claim, by default", async () => {
    const r = await preEdit(team.sam.token, "sam-claims", "api/users.ts");
    expect(r.body?.decision).toBe("ask");
    expect(r.body?.reason).toContain("api/users.ts is claimed by @lea (exclusive");
    expect(r.body?.reason).toContain("refonte du contrat /users");
    expect(await active(sessions.sam ?? "")).toHaveLength(0);
  });

  it("maps every enforcement level, stored off as warn and block as ask, and never says allow", async () => {
    for (const [level, expected] of [
      ["warn", "warn"],
      ["ask", "ask"],
      ["off", "warn"],
      ["block", "ask"],
    ] as const) {
      await hub.db
        .update(teamTable)
        .set({ settings: { claims_enforcement: level } })
        .where(eq(teamTable.id, team.teamId));
      const r = await preEdit(team.sam.token, "sam-claims", "api/users.ts");
      expect(r.body?.decision ?? null).toBe(expected);
      expect(JSON.stringify(r.body)).not.toContain("allow");
    }
    await hub.db.update(teamTable).set({ settings: {} }).where(eq(teamTable.id, team.teamId));
  });

  it("shows live claims in team_overview, with the holder and the time left, without the reason", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    await call(lea, "claim", { scope: ["docs/overview.md"], reason: "rewrite <b>now</b>", ttl_s: 1800 });
    const sam = await mcpClient(hub.url, team.sam.token);
    const ov = (await call(sam, "team_overview")).json() as { claims: Array<Record<string, unknown>> };
    expect(ov.claims.find((c) => c.scope === "docs/overview.md")).toMatchObject({
      holder: "@lea",
      mode: "exclusive",
      mine: false,
      minutes_left: 30,
    });
    expect(JSON.stringify(ov.claims)).not.toContain("rewrite");
    await lea.close();
    await sam.close();
  });

  it("covers files under a glob", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect((await call(lea, "claim", { scope: ["src/api/**"] })).isError).toBe(false);
    expect((await preEdit(team.malik.token, "malik-claims", "src/api/deep/x.ts")).body?.decision).toBe("ask");
    expect((await preEdit(team.malik.token, "malik-claims", "src/web/x.ts")).status).toBe(204);
    await lea.close();
  });

  it("puts a 10-minute intent claim on a free file, renews it, and warns others", async () => {
    expect((await preEdit(team.malik.token, "malik-claims", "lib/date.ts")).status).toBe(204);
    const onFile = async () => (await active(sessions.malik ?? "")).filter((c) => c.scope === "lib/date.ts");
    expect(await onFile()).toMatchObject([{ mode: "intent", ttlS: 600 }]);
    await preEdit(team.malik.token, "malik-claims", "lib/date.ts");
    expect(await onFile()).toHaveLength(1);
    const other = await preEdit(team.sam.token, "sam-claims", "lib/date.ts");
    expect(other.body?.decision).toBe("warn");
    expect(other.body?.reason).toContain("being edited by @malik (intent");
  });

  it("refuses excluded paths, oversized TTLs and claims outside a project", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    expect(code(await call(sam, "claim", { scope: [".env.local"] }))).toBe("E_INVALID");
    expect((await call(sam, "claim", { scope: ["a.ts"], ttl_s: 20000 })).isError).toBe(true);
    expect((await preEdit(team.sam.token, "sam-claims", "certs/key.pem")).status).toBe(204);
    const { agent_id } = await startSession(hub.url, team.sam.token, "sam-no-repo");
    expect(code(await call(sam, "claim", { agent: agent_id, scope: ["a.ts"] }))).toBe("E_INVALID");
    expect((await call(sam, "claim", { agent: agent_id, scope: ["resource:staging-db"] })).isError).toBe(false);
    await sam.close();
  });

  it("releases on request and intent claims at session end", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    expect(JSON.parse((await call(lea, "claim_release", { all_mine: true })).text).released).toBeGreaterThan(0);
    // Free to edit, but Léa's release is recent: Sam is told she worked on it, as a warning.
    const after = await preEdit(team.sam.token, "sam-claims", "api/users.ts");
    expect(after.body?.decision).toBe("warn");
    expect(after.body?.reason).toContain("@lea edited this path");
    expect(after.body?.reason).toContain("(claim released)");
    await fetch(`${hub.url}/v1/agents/session/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: "sam-claims" }),
    });
    expect(await active(sessions.sam ?? "")).toEqual([]);
    await lea.close();
  });

  it("refuses guests, quarantined agents and the kill switch", async () => {
    const malik = await mcpClient(hub.url, team.malik.token);
    await hub.db
      .update(agent)
      .set({ trustLevel: "quarantined" })
      .where(eq(agent.id, sessions.malik ?? ""));
    expect(code(await call(malik, "claim", { agent: sessions.malik, scope: ["b.ts"] }))).toBe("E_FORBIDDEN");
    await hub.db
      .update(agent)
      .set({ trustLevel: "trusted" })
      .where(eq(agent.id, sessions.malik ?? ""));
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    expect(code(await call(malik, "claim", { agent: sessions.malik, scope: ["b.ts"] }))).toBe("E_FORBIDDEN");
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
    await hub.db.update(teamTable).set({ killSwitchAt: new Date() }).where(eq(teamTable.id, team.teamId));
    expect(code(await call(malik, "claim", { agent: sessions.malik, scope: ["b.ts"] }))).toBe("E_KILL_SWITCH");
    expect((await preEdit(team.malik.token, "malik-claims", "b.ts")).status).toBe(204);
    await hub.db.update(teamTable).set({ killSwitchAt: null }).where(eq(teamTable.id, team.teamId));
    await malik.close();
  });
});
