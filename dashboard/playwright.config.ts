import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",

  // Run all tests in parallel within a file; files run in parallel too.
  fullyParallel: true,

  // Fail the build if any test.only is accidentally left in CI.
  forbidOnly: !!process.env.CI,

  // Retry failed tests once in CI; no retries locally (fail fast during dev).
  retries: process.env.CI ? 1 : 0,

  // Use 4 workers locally, 2 in CI (API mocking is cheap but Next.js SSR has overhead).
  workers: process.env.CI ? 2 : 4,

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",

    // Capture traces on the first retry so failures are diagnosable.
    trace: "on-first-retry",

    // Screenshot on failure.
    screenshot: "only-on-failure",
  },

  // Playwright starts the dev server automatically if nothing is already listening on 3000.
  // Set JOBDASH_CACHE_DIR so tests write to an isolated cache that doesn't pollute dev data.
  webServer: {
    command: "JOBDASH_CACHE_DIR=.cache-test npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
