import { defineConfig } from "@playwright/test";

// Console journeys (SPEC « Parcours clés »). Each describe starts its own hub with the test harness.
export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  use: { browserName: "chromium", trace: "retain-on-failure" },
  outputDir: "../../test-results",
});
