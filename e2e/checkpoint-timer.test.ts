import { afterEach, expect, it, vi } from "vitest";
import { startHub } from "../apps/hub/test/harness.js";

const CHECKPOINT_EVERY_MS = 10 * 60_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps running when the database is down at a checkpoint tick", async () => {
  // Only the hub's own timers are faked: the database and the HTTP server keep real ones.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const hub = await startHub();
  await hub.seed(); // the auth library finishes its own startup queries first
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    vi.spyOn(hub.db, "select").mockImplementation(() => {
      throw new Error("connection terminated unexpectedly");
    });
    await vi.advanceTimersByTimeAsync(CHECKPOINT_EVERY_MS);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off("unhandledRejection", unhandled);
    vi.restoreAllMocks();
    await hub.stop();
  }
});
