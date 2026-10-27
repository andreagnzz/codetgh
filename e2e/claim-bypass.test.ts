import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let repo: string;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  repo = gitRepo();
  await runHook("session-start", { session_id: "lea-a2", source: "startup", cwd: repo }, hookEnv(hub.url, team.lea.token));
  await runHook("session-start", { session_id: "sam-a2", source: "startup", cwd: repo }, hookEnv(hub.url, team.sam.token));
});
afterAll(() => hub.stop());

type Out = { hookSpecificOutput?: { permissionDecision?: string; additionalContext?: string } } | null;

it("refuses a claim that would cover the whole project", async () => {
  const lea = await mcpClient(hub.url, team.lea.token);
  for (const scope of ["**", "*", "**/*", "./**", "**/*.ts"]) {
    const r = await call(lea, "claim", { scope: [scope], mode: "exclusive" });
    expect(r.isError, scope).toBe(true);
    expect(r.text).toMatch(/whole project|narrower/);
  }
  expect((await call(lea, "claim", { scope: ["src/**"], mode: "exclusive" })).isError).toBe(false);
});

it("turns ask into a warning for a session in bypassPermissions, where nobody can answer", async () => {
  const edit = (mode?: string) =>
    runHook(
      "pre-edit",
      {
        session_id: "sam-a2",
        cwd: repo,
        tool_name: "Edit",
        tool_input: { file_path: join(repo, "src/a.ts") },
        ...(mode && { permission_mode: mode }),
      },
      hookEnv(hub.url, team.sam.token),
    );
  // The team keeps the default (ask): a human-driven session still gets the prompt.
  expect(((await edit("default")).out as Out)?.hookSpecificOutput?.permissionDecision).toBe("ask");
  const bypass = (await edit("bypassPermissions")).out as Out;
  expect(bypass?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  expect(bypass?.hookSpecificOutput?.additionalContext).toMatch(/^CodeTgh: .*@lea/s);
});
