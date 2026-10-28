import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, code, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost, hubRest } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-wq", { repo: ACME_REPO });
  await startSession(hub.url, team.malik.token, "malik-wq", { repo: ACME_REPO });
});
afterAll(() => hub.stop());

it("rate-limits a person's writes the way it limits their messages", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const codes: Array<string | null> = [];
  for (let i = 0; i < 12; i++) codes.push(code(await call(sam, "task_create", { title: `task ${i}` })));
  expect(codes.slice(0, 9)).toEqual(Array(9).fill(null));
  expect(codes).toContain("E_RATE_LIMITED");
  // A new session does not reset the budget: it is per person.
  const res = await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session", {
    session_id: "sam-wq2",
    branch: "main",
    repo_fingerprint: ACME_REPO,
    repo_name: "acme/webapp",
  });
  expect(res.status).toBe(429);
});

// The console and the Slack relay write as the person: their sends take the budget of the person's agents.
it("rate-limits a person's console replies with the budget of their messages", async () => {
  const lea = await mcpClient(hub.url, team.lea.token);
  const sent = JSON.parse((await call(lea, "send_message", { to: "@sam", kind: "note", body: "hello", allow_offline: true })).text);
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++)
    statuses.push((await consolePost(hub.url, team.lea.cookie, `/console/threads/${sent.thread}/reply`, { body: `reply ${i}` })).status);
  expect(statuses.slice(0, 8)).toEqual(Array(8).fill(204));
  expect(statuses).toContain(429);
});

it("caps the claims one person holds at once", async () => {
  const malik = await mcpClient(hub.url, team.malik.token);
  for (let batch = 0; batch < 5; batch++) {
    const scope = Array.from({ length: 20 }, (_, i) => `src/m${batch}/f${i}.ts`);
    expect(code(await call(malik, "claim", { scope, mode: "shared" })), `batch ${batch}`).toBeNull();
  }
  expect(code(await call(malik, "claim", { scope: ["src/one-more.ts"], mode: "shared" }))).toBe("E_TOO_LARGE");
});
