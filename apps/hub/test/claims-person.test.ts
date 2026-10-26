import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claim } from "../src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const sessions: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  for (const [key, who, id] of [
    ["lea1", "lea", "lea-one"],
    ["lea2", "lea", "lea-two"],
    ["sam", "sam", "sam-one"],
  ] as const)
    sessions[key] = (await startSession(hub.url, team[who].token, id, { repo: ACME_REPO })).agent_id ?? "";
});
afterAll(() => hub.stop());

const code = (r: { text: string; isError: boolean }) => (r.isError ? JSON.parse(r.text).code : null);
const post = async (path: string, token: string, body: unknown) => {
  const res = await fetch(`${hub.url}/v1/claims/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: res.status === 200 ? ((await res.json()) as { decision?: string; reason?: string; paths?: Check["paths"] }) : null,
  };
};
type Check = { paths: Array<{ path: string; holders: Array<{ handle: string; mode: string }>; recent: string[] }> };

describe("claims belong to a person, not to a session", () => {
  it("does not make two sessions of the same person conflict, and still does for another person", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const sam = await mcpClient(hub.url, team.sam.token);
    expect((await call(lea, "claim", { agent: sessions.lea1, scope: ["app/main.ts"] })).isError).toBe(false);
    // The second session of the same person claims, checks and edits the same file without a word.
    expect((await call(lea, "claim", { agent: sessions.lea2, scope: ["app/main.ts"] })).isError).toBe(false);
    const own = (await call(lea, "claim_check", { agent: sessions.lea2, paths: ["app/main.ts"] })).json() as Check;
    expect(own.paths[0]?.holders).toEqual([]);
    expect((await post("pre-edit", team.lea.token, { session_id: "lea-two", path: "app/main.ts" })).status).toBe(204);
    expect(
      ((await post("check", team.lea.token, { session_id: "lea-two", paths: ["app/main.ts"] })).body as Check).paths[0]?.holders,
    ).toEqual([]);

    expect(code(await call(sam, "claim", { agent: sessions.sam, scope: ["app/main.ts"] }))).toBe("E_CLAIM_CONFLICT");
    const seen = (await call(sam, "claim_check", { agent: sessions.sam, paths: ["app/main.ts"] })).json() as Check;
    expect(seen.paths[0]?.holders.map((h) => h.handle)).toEqual(["lea", "lea"]);
    expect((await post("pre-edit", team.sam.token, { session_id: "sam-one", path: "app/main.ts" })).body?.decision).toBe("ask");
    await lea.close();
    await sam.close();
  });

  it("does not warn a person about their own intent claim from another session", async () => {
    expect((await post("pre-edit", team.lea.token, { session_id: "lea-one", path: "app/util.ts" })).status).toBe(204);
    expect((await post("pre-edit", team.lea.token, { session_id: "lea-two", path: "app/util.ts" })).status).toBe(204);
    const other = await post("pre-edit", team.sam.token, { session_id: "sam-one", path: "app/util.ts" });
    expect(other.body?.decision).toBe("warn");
  });

  it("checks a repository's paths without a session, for the pre-push hook: only other people's claims", async () => {
    const asSam = await post("check", team.sam.token, { repo_fingerprint: ACME_REPO, paths: ["app/main.ts", "app/free.ts"] });
    expect((asSam.body as Check).paths.map((p) => p.holders.length > 0)).toEqual([true, false]);
    const asLea = await post("check", team.lea.token, { repo_fingerprint: ACME_REPO, paths: ["app/main.ts"] });
    expect((asLea.body as Check).paths[0]?.holders).toEqual([]);
    // A repository the hub does not know has no claims.
    const unknown = await post("check", team.sam.token, { repo_fingerprint: "b".repeat(64), paths: ["app/main.ts"] });
    expect(unknown.body).toEqual({ paths: [] });
    expect((await post("check", team.sam.token, { paths: ["a"] })).status).toBe(400);
  });
});

describe("recent overlap", () => {
  const released = (scope: string) =>
    hub.db
      .select()
      .from(claim)
      .where(and(eq(claim.scope, scope), eq(claim.holderUserId, team.lea.userId)));

  it("mentions a claim released in the last 30 minutes, as a warning only", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    await call(lea, "claim", { agent: sessions.lea1, scope: ["docs/guide.md"] });
    const sam = await mcpClient(hub.url, team.sam.token);
    // While it is held it is a holder, not a recent edit.
    const live = (await call(sam, "claim_check", { agent: sessions.sam, paths: ["docs/guide.md"] })).json() as Check;
    expect(live.paths[0]).toMatchObject({ holders: [{ handle: "lea" }], recent: [] });

    await call(lea, "claim_release", { agent: sessions.lea1, all_mine: true });
    const check = (await call(sam, "claim_check", { agent: sessions.sam, paths: ["docs/guide.md", "docs/other.md"] })).json() as Check;
    expect(check.paths[0]?.holders).toEqual([]);
    expect(check.paths[0]?.recent).toEqual(["@lea edited this path 1 min ago (claim released)"]);
    expect(check.paths[1]?.recent).toEqual([]);
    // Only a warning: no ask, and the file is not held against anyone.
    const edit = await post("pre-edit", team.sam.token, { session_id: "sam-one", path: "docs/guide.md" });
    expect(edit.body?.decision).toBe("warn");
    expect(edit.body?.reason).toContain("docs/guide.md: @lea edited this path 1 min ago (claim released)");
    expect((await call(sam, "claim", { agent: sessions.sam, scope: ["docs/guide.md"] })).isError).toBe(false);
    // Their own recent edit is no news to them, from this session or another.
    const leaSees = (await call(lea, "claim_check", { agent: sessions.lea2, paths: ["docs/guide.md"] })).json() as Check;
    expect(leaSees.paths[0]?.recent).toEqual([]);
    await lea.close();
    await sam.close();
  });

  it("counts the last renewal, says expired for a claim that ran out, and forgets after 30 minutes", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const sam = await mcpClient(hub.url, team.sam.token);
    await call(lea, "claim", { agent: sessions.lea1, scope: ["docs/old.md"], ttl_s: 60 });
    const [row] = await released("docs/old.md");
    const at = (minutesAgo: number, extra: object = {}) =>
      hub.db
        .update(claim)
        .set({ expiresAt: new Date(Date.now() - minutesAgo * 60_000 + 60_000), ...extra })
        .where(eq(claim.id, row?.id ?? ""));
    const recent = async () =>
      ((await call(sam, "claim_check", { agent: sessions.sam, paths: ["docs/old.md"] })).json() as Check).paths[0]?.recent;

    // Last touched 12 minutes ago, never released: it ran out.
    await at(12);
    expect(await recent()).toEqual(["@lea edited this path 12 min ago (claim expired)"]);
    await at(12, { releasedAt: new Date(), releaseReason: "released" });
    expect(await recent()).toEqual(["@lea edited this path 12 min ago (claim released)"]);
    await at(29);
    expect(await recent()).toHaveLength(1);
    await at(31);
    expect(await recent()).toEqual([]);
    await lea.close();
    await sam.close();
  });

  it("covers globs, keeps to the project, and says it once per person", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const sam = await mcpClient(hub.url, team.sam.token);
    await call(lea, "claim", { agent: sessions.lea1, scope: ["lib/**"] });
    await call(lea, "claim", { agent: sessions.lea2, scope: ["lib/a.ts"] });
    await call(lea, "claim_release", { agent: sessions.lea1, all_mine: true });
    await call(lea, "claim_release", { agent: sessions.lea2, all_mine: true });
    const check = (await call(sam, "claim_check", { agent: sessions.sam, paths: ["lib/a.ts"] })).json() as Check;
    expect(check.paths[0]?.recent).toEqual(["@lea edited this path 1 min ago (claim released)"]);
    const other = (await startSession(hub.url, team.sam.token, "sam-billing", { repo: "c".repeat(64) })).agent_id ?? "";
    const away = (await call(sam, "claim_check", { agent: other, paths: ["lib/a.ts"] })).json() as Check;
    expect(away.paths[0]?.recent).toEqual([]);
    expect(
      await hub.db
        .select()
        .from(claim)
        .where(and(eq(claim.holderUserId, team.lea.userId), isNull(claim.releasedAt))),
    ).toEqual([]);
    await lea.close();
    await sam.close();
  });
});
