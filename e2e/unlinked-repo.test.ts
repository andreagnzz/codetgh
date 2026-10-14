import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, project } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const CLIENT = "git@github.com:client-under-nda/secret-app.git";

it("creates no project and no agent for a repository nobody linked, and says so", async () => {
  const repo = gitRepo(CLIENT);
  const r = await runHook("session-start", { session_id: "sam-nda", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  expect(r.out).toBeNull();
  expect(
    await hub.db
      .select()
      .from(project)
      .where(eq(project.repoFingerprint, repoFingerprint(CLIENT))),
  ).toHaveLength(0);
  expect(await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-nda"))).toHaveLength(0);
});

it("sends nothing but the fingerprint from an unlinked repository: no branch, no name, no paths", async () => {
  const seen: Array<{ path: string; body: string }> = [];
  const spy = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body });
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ agent_id: null, paused: false, context: "", linked: false }));
    });
  });
  await new Promise<void>((r) => spy.listen(0, "127.0.0.1", r));
  const env = hookEnv(`http://127.0.0.1:${(spy.address() as AddressInfo).port}`, team.sam.token);
  const repo = gitRepo(CLIENT);
  await runHook("session-start", { session_id: "sam-nda-2", source: "startup", cwd: repo }, env);
  await runHook(
    "pre-edit",
    { session_id: "sam-nda-2", cwd: repo, tool_name: "Edit", tool_input: { file_path: join(repo, "src/payroll.ts") } },
    env,
  );
  await runHook("user-prompt-submit", { session_id: "sam-nda-2", prompt: "go" }, env);
  await runHook("stop", { session_id: "sam-nda-2", cwd: repo }, env);
  spy.close();

  expect(seen.map((s) => s.path)).toEqual(["/v1/agents/session"]);
  const sent = JSON.parse(seen[0]?.body ?? "{}");
  expect(sent.repo_fingerprint).toBe(repoFingerprint(CLIENT));
  expect(sent.branch).toBeUndefined();
  expect(sent.repo_name).toBeUndefined();
});

it("still works in a linked repository", async () => {
  const repo = gitRepo("git@github.com:acme/webapp.git");
  const r = await runHook("session-start", { session_id: "sam-linked", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
  expect(String((r.out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext)).toContain("codetgh_context");
});
