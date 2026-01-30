import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests.
 *
 * These tests run against the local dev server with auth bypass enabled.
 * In CI, the worker is started with E2E_TEST_MODE=true which enables
 * the /api/test/auth endpoint for creating test sessions.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start both frontend and worker for tests
  webServer: [
    {
      command: 'npm run dev:worker',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 120000,
      env: {
        E2E_TEST_MODE: 'true',
      },
    },
    {
      command: 'npm run dev:frontend',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 120000,
    },
  ],
});
