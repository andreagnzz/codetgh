import { request } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { csrfToken } from "./helpers.js";

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

// Announce 200 KB but send 1 KB: the limit answers from Content-Length, so the hub never resets a socket
// the client is still writing to (a race that broke this test on Windows).
function oversized(path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      new URL(path, hub.url),
      { method: "POST", headers: { ...headers, "content-length": String(200 * 1024) } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        req.destroy();
      },
    );
    req.on("error", reject);
    req.write("x".repeat(1024));
  });
}

it("refuses oversized bodies on the console and the sign-in routes", async () => {
  const csrf = await csrfToken(hub.url, team.lea.cookie);
  const form = { cookie: team.lea.cookie, "X-CSRF-Token": csrf, "content-type": "application/x-www-form-urlencoded", origin: hub.url };
  expect(await oversized("/console/settings", form)).toBe(413);
  expect(await oversized("/api/auth/sign-in/email", { "content-type": "application/json", origin: hub.url })).toBe(413);
  // The REST API keeps its 413 too, not a generic 500.
  expect(await oversized("/v1/messages", { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" })).toBe(413);
});
