import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("never writes a request's text to the logs when the database refuses it", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // Postgres refuses NUL in text: the driver's error carries the query parameters, message body included.
    const res = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        to: "@lea",
        kind: "note",
        body: "private plan\u0000 for the launch",
        priority: "normal",
        allow_offline: true,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain("private plan");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private plan");
  } finally {
    errors.mockRestore();
  }
});
