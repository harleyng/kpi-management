import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E.
 *
 * Runs OUTSIDE the Vitest glob (`src/**`): specs live in `e2e/specs`, so the two runners never
 * discover each other's files. Authentication is simulated — there is no login step; the user and
 * role are switched in-app from the session switcher.
 *
 * There is no database: the app runs on the mock `DataGateway`, so a spec needs no teardown helper.
 * Reset the seed through the gateway (`resetSeed()`, Phase 1.2) at the start of a spec instead.
 */
const PORT = Number(process.env.E2E_PORT ?? 8182);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    timezoneId: 'Asia/Ho_Chi_Minh',
    locale: 'vi-VN',
  },

  // Start this project's dev server on a DEDICATED port so it never reuses a different app
  // that happens to own the default one. `--strictPort` fails loudly instead of drifting.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
