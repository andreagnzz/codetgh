import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, auditEvent, claim } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost, gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
});
afterAll(() => hub.stop());

type Out = {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
  systemMessage?: string;
} | null;

it("asks before Sam edits a file Léa claimed, per the team's enforcement level (scenario 2)", async () => {
  const lea = hookEnv(hub.url, team.lea.token);
  const sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "lea-s2", source: "startup", cwd: repo }, lea);
  await runHook("session-start", { session_id: "sam-s2", source: "startup", cwd: repo }, sam);

  const leaMcp = await mcpClient(hub.url, team.lea.token);
  const claimed = await call(leaMcp, "claim", {
    scope: ["api/users.ts"],
    mode: "exclusive",
    ttl_s: 1800,
    reason: "refonte du contrat /users",
  });
  expect(JSON.parse(claimed.text).claims[0].id).toMatch(/^clm_/);
  const [before] = await hub.db.select().from(claim).where(eq(claim.holderUserId, team.lea.userId));

  const edit = {
    session_id: "sam-s2",
    cwd: repo,
    tool_name: "Edit",
    tool_input: { file_path: join(repo, "api/users.ts"), old_string: "a", new_string: "b" },
  };
  const outputs: Out[] = [];

  const ask = await runHook("pre-edit", edit, sam);
  outputs.push(ask.out as Out);
  const reason = (ask.out as Out)?.hookSpecificOutput?.permissionDecisionReason ?? "";
  expect((ask.out as Out)?.hookSpecificOutput?.permissionDecision).toBe("ask");
  expect(reason).toMatch(/api\/users\.ts/);
  expect(reason).toMatch(/@lea/);
  expect(reason).toMatch(/exclusive/);
  expect(reason).toMatch(/refonte du contrat \/users/);
  const minutes = Number(reason.match(/(\d+) min/)?.[1]);
  expect(minutes).toBeGreaterThanOrEqual(29);
  expect(minutes).toBeLessThanOrEqual(30);
  expect(ask.code).toBe(0);
  expect(ask.ms).toBeLessThan(3000);

  const levels = [
    ["warn", (o: Out) => expect(o?.hookSpecificOutput).toMatchObject({ additionalContext: expect.stringMatching(/@lea.*exclusive/s) })],
    ["ask", (o: Out) => expect(o?.hookSpecificOutput).toMatchObject({ permissionDecision: "ask" })],
  ] as const;
  for (const [level, check] of levels) {
    expect(
      (await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", claims_enforcement: level })).status,
    ).toBeLessThan(400);
    const r = await runHook("pre-edit", edit, sam);
    outputs.push(r.out as Out);
    check(r.out as Out);
    if (level === "warn") expect((r.out as Out)?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  }
  expect(JSON.stringify(outputs)).not.toContain("allow");

  // Léa's claim is untouched and Sam got no claim of his own on the file.
  const [after] = await hub.db
    .select()
    .from(claim)
    .where(eq(claim.id, before?.id ?? ""));
  expect(after).toMatchObject({ mode: "exclusive", releasedAt: null });
  expect(after?.expiresAt.getTime()).toBeGreaterThanOrEqual(before?.expiresAt.getTime() ?? 0);
  expect(
    await hub.db
      .select()
      .from(claim)
      .where(and(eq(claim.holderUserId, team.sam.userId), eq(claim.scope, "api/users.ts"), isNull(claim.releasedAt))),
  ).toEqual([]);

  const samMcp = await mcpClient(hub.url, team.sam.token);
  const check = (await call(samMcp, "claim_check", { paths: ["api/users.ts"] })).json();
  expect(check.paths[0].holders[0]).toMatchObject({ handle: "lea", mode: "exclusive" });
  expect(check.paths[0].holders[0].remaining_min).toBeGreaterThanOrEqual(29);
  expect(
    await hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "claim.created"), eq(auditEvent.actorUserId, team.lea.userId))),
  ).toHaveLength(1);
  await leaMcp.close();
  await samMcp.close();
});

it("checks a file whose name starts with two dots, and leaves a path outside the repository alone", async () => {
  const lea = hookEnv(hub.url, team.lea.token);
  const sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "lea-dots", source: "startup", cwd: repo }, lea);
  await runHook("session-start", { session_id: "sam-dots", source: "startup", cwd: repo }, sam);
  const [leaAgent] = await hub.db.select().from(agent).where(eq(agent.sessionId, "lea-dots"));
  const leaMcp = await mcpClient(hub.url, team.lea.token);
  await call(leaMcp, "claim", { agent: leaAgent?.id, scope: ["..cache/x.txt"], mode: "exclusive", ttl_s: 1800 });
  await leaMcp.close();

  const edit = (file_path: string) => ({
    session_id: "sam-dots",
    cwd: repo,
    tool_name: "Write",
    tool_input: { file_path, content: "a" },
  });
  const inside = await runHook("pre-edit", edit(join(repo, "..cache/x.txt")), sam);
  expect((inside.out as Out)?.hookSpecificOutput?.permissionDecisionReason ?? "").toMatch(/\.\.cache\/x\.txt.*@lea/s);
  expect((await runHook("pre-edit", edit(join(repo, "../outside.txt")), sam)).out).toBeNull();
});

it("checks edits against the session's repository, even when the first edit is in another one", async () => {
  const lea = hookEnv(hub.url, team.lea.token);
  await runHook("session-start", { session_id: "lea-root", source: "startup", cwd: repo }, lea);
  const [leaAgent] = await hub.db.select().from(agent).where(eq(agent.sessionId, "lea-root"));
  const leaMcp = await mcpClient(hub.url, team.lea.token);
  await call(leaMcp, "claim", { agent: leaAgent?.id, scope: ["src/index.ts"], mode: "exclusive", ttl_s: 1800 });
  await leaMcp.close();
  // A submodule or a folder added with /add-dir: another git repository, with a file at the same relative path.
  const other = gitRepo("git@github.com:acme/vendored-lib.git");
  const edit = (session_id: string, file_path: string) => ({
    session_id,
    cwd: repo,
    tool_name: "Edit",
    tool_input: { file_path, old_string: "a", new_string: "b" },
  });
  const samClaims = () =>
    hub.db
      .select()
      .from(claim)
      .where(and(eq(claim.holderUserId, team.sam.userId), eq(claim.scope, "src/index.ts")));

  const sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-root", source: "startup", cwd: repo }, sam);
  expect((await runHook("pre-edit", edit("sam-root", join(other, "src/index.ts")), sam)).out).toBeNull();
  expect(await samClaims()).toEqual([]);
  const inside = await runHook("pre-edit", edit("sam-root", join(repo, "src/index.ts")), sam);
  expect((inside.out as Out)?.hookSpecificOutput?.permissionDecisionReason ?? "").toMatch(/src\/index\.ts.*@lea/s);

  // A session started outside any repository takes the one it joins.
  const malik = hookEnv(hub.url, team.malik.token);
  const home = mkdtempSync(join(tmpdir(), "codetgh-home-"));
  await runHook("session-start", { session_id: "malik-root", source: "startup", cwd: home }, malik);
  await runHook("cwd-changed", { session_id: "malik-root", cwd: repo, old_cwd: home, new_cwd: repo }, malik);
  expect((await runHook("pre-edit", edit("malik-root", join(other, "src/index.ts")), malik)).out).toBeNull();
  const joined = await runHook("pre-edit", edit("malik-root", join(repo, "src/index.ts")), malik);
  expect((joined.out as Out)?.hookSpecificOutput?.permissionDecisionReason ?? "").toMatch(/src\/index\.ts.*@lea/s);
});

it("reports at the end of a turn a claimed file changed through the shell", async () => {
  const sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-shell", source: "startup", cwd: repo }, sam);
  mkdirSync(join(repo, "api"), { recursive: true });
  writeFileSync(join(repo, "api/users.ts"), "export const changed = true;\n");
  const stop = await runHook("stop", { session_id: "sam-shell", cwd: repo }, sam);
  expect((stop.out as Out)?.systemMessage).toMatch(/api\/users\.ts.*@lea/s);
  // Once per file and claim per session.
  expect((await runHook("stop", { session_id: "sam-shell", cwd: repo }, sam)).out).toBeNull();
});

it("leaves files edited with the editor tools out of the shell report", async () => {
  const sam = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-tools", source: "startup", cwd: repo }, sam);
  await runHook(
    "post-edit",
    { session_id: "sam-tools", cwd: repo, tool_name: "Write", tool_input: { file_path: join(repo, "api/users.ts") } },
    sam,
  );
  expect((await runHook("stop", { session_id: "sam-tools", cwd: repo }, sam)).out).toBeNull();
});
