import { defineConfig } from "vitest/config";

// Timing criteria, one file at a time so the numbers measure the hook and not CPU contention.
export default defineConfig({
  test: { include: ["e2e/**/*.perf.test.ts"], fileParallelism: false, testTimeout: 60000, hookTimeout: 30000 },
});
