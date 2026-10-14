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
  repo = gitRepo("https://github.com/acme/latency.git");
  await runHook("session-start", { session_id: "lea-lat", source: "startup", cwd: repo }, hookEnv(hub.url, team.lea.token));
  const lea = await mcpClient(hub.url, team.lea.token);
  for (let i = 0; i < 4; i++) await call(lea, "claim", { scope: Array.from({ length: 10 }, (_, j) => `src/m${i}/f${j}.ts`) });
  await lea.close();
});
afterAll(() => hub.stop());

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] ?? 0;

it("adds under 300 ms (p95) to an edit, node start included, with 40 active claims", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  await runHook("session-start", { session_id: "sam-lat", source: "startup", cwd: repo }, env);
  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const path = i % 2 ? `src/m1/f${i % 10}.ts` : `src/free/f${i}.ts`;
    const r = await runHook(
      "pre-edit",
      { session_id: "sam-lat", cwd: repo, tool_name: "Edit", tool_input: { file_path: join(repo, path) } },
      env,
    );
    times.push(r.ms);
  }
  console.log(`pre-edit p95 ${Math.round(p95(times))} ms, median ${Math.round([...times].sort((a, b) => a - b)[15] ?? 0)} ms`);
  expect(p95(times)).toBeLessThan(300);
});
