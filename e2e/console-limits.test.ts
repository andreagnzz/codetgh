import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("caps the console live streams one person keeps open, and frees a slot on close", async () => {
  const open = () => {
    const ctl = new AbortController();
    return fetch(`${hub.url}/console/stream`, { headers: { cookie: team.lea.cookie }, signal: ctl.signal }).then((res) => ({ res, ctl }));
  };
  const streams = [];
  for (let i = 0; i < 8; i++) streams.push(await open());
  expect(streams.map((s) => s.res.status)).toEqual(Array(8).fill(200));
  const extra = await open();
  expect(extra.res.status).toBe(429);
  streams[0]?.ctl.abort();
  await new Promise((r) => setTimeout(r, 200));
  const again = await open();
  expect(again.res.status).toBe(200);
  for (const s of [...streams, again]) s.ctl.abort();
});

it("refuses oversized bodies on the console and the sign-in routes", async () => {
  const big = "x".repeat(200 * 1024);
  expect((await consolePost(hub.url, team.lea.cookie, "/console/settings", { secret_patterns: big })).status).toBe(413);
  const res = await fetch(`${hub.url}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: hub.url },
    body: JSON.stringify({ email: "lea@example.com", password: big }),
  });
  expect(res.status).toBe(413);
  // The REST API keeps its 413 too, not a generic 500.
  const rest = await fetch(`${hub.url}/v1/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
    body: JSON.stringify({ to: "@sam", kind: "note", body: big }),
  });
  expect(rest.status).toBe(413);
});
