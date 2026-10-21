import * as fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import { loadState, saveState } from "../src/hook.js";

// Hooks of one session run in parallel: each saves only the keys it changed, over what is on disk now.
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  return { ...real, renameSync: vi.fn(real.renameSync) };
});
beforeAll(() => {
  process.env.CODETGH_STATE_DIR = mkdtempSync(join(tmpdir(), "codetgh-state-"));
});

it("keeps both keys when two hooks save different ones", () => {
  saveState("s-merge", { etag: "e1" });
  saveState("s-merge", { touched: ["src/a.ts"] });
  expect(loadState("s-merge")).toEqual({ etag: "e1", touched: ["src/a.ts"] });
});

it("retries the rename while another hook holds the file (Windows EBUSY, EPERM)", () => {
  const busy = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  vi.mocked(fs.renameSync).mockImplementationOnce(busy("EBUSY")).mockImplementationOnce(busy("EPERM"));
  saveState("s-busy", { etag: "e2" });
  expect(loadState("s-busy")).toEqual({ etag: "e2" });
});
