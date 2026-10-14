import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts", "e2e/**/*.test.ts"],
    // Timing criteria run alone (pnpm test:perf, vitest.perf.config.ts).
    exclude: ["**/node_modules/**", "e2e/**/*.perf.test.ts"],
    globalSetup: ["apps/hub/test/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
