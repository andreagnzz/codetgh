import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-wq", { repo: ACME_REPO });
  await startSession(hub.url, team.malik.token, "malik-wq", { repo: ACME_REPO });
});
afterAll(() => hub.stop());

const code = (r: { isError: boolean; text: string }) => (r.isError ? JSON.parse(r.text).code : null);

it("rate-limits a person's writes the way it limits their messages", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const codes: Array<string | null> = [];
  for (let i = 0; i < 12; i++) codes.push(code(await call(sam, "task_create", { title: `task ${i}` })));
  expect(codes.slice(0, 9)).toEqual(Array(9).fill(null));
  expect(codes).toContain("E_RATE_LIMITED");
  // A new session does not reset the budget: it is per person.
  const res = await fetch(`${hub.url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: "sam-wq2", branch: "main", repo_fingerprint: ACME_REPO, repo_name: "acme/webapp" }),
  });
  expect(res.status).toBe(429);
});

it("caps the claims one person holds at once", async () => {
  const malik = await mcpClient(hub.url, team.malik.token);
  for (let batch = 0; batch < 5; batch++) {
    const scope = Array.from({ length: 20 }, (_, i) => `src/m${batch}/f${i}.ts`);
    expect(code(await call(malik, "claim", { scope, mode: "shared" })), `batch ${batch}`).toBeNull();
  }
  expect(code(await call(malik, "claim", { scope: ["src/one-more.ts"], mode: "shared" }))).toBe("E_TOO_LARGE");
});
