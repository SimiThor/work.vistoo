import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests need the local Supabase stack (incl. Mailpit) and a running app:
 *   npm run supabase:start && npm run db:migrate && npm run dev
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: process.env.E2E_SKIP_SETUP ? undefined : "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    locale: "de-DE",
    timezoneId: "Pacific/Auckland", // far from UTC: catches calendar-day shifts
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
