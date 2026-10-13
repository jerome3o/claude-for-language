import { defineConfig, devices } from '@playwright/test';

// Ports: 3000 (Vite) + 8787 (worker) by default. Another session using those ports? Run with
// E2E_WEB_PORT / E2E_API_PORT (e.g. 3010 / 8797): both servers start there, the Vite proxy
// follows, and every spec reads E2E_API_URL / E2E_BASE_URL (set here for the test workers).
const WEB_PORT = process.env.E2E_WEB_PORT || '3000';
const API_PORT = process.env.E2E_API_PORT || '8787';
process.env.E2E_BASE_URL ||= `http://localhost:${WEB_PORT}`;
process.env.E2E_API_URL ||= `http://localhost:${API_PORT}`;
const customPorts = WEB_PORT !== '3000' || API_PORT !== '8787';

/**
 * Playwright configuration for E2E tests.
 *
 * These tests run against the local dev server with auth bypass enabled.
 * In CI, the worker is started with E2E_TEST_MODE=true which enables
 * the /api/test/auth endpoint for creating test sessions.
 */
export default defineConfig({
  testDir: './tests',
  // Run tests sequentially to avoid race conditions with auth/session management
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: process.env.E2E_BASE_URL,
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
      command: customPorts
        ? `npm exec -w worker -- wrangler dev --port ${API_PORT} --inspector-port ${Number(API_PORT) + 1000}`
        : 'npm run dev:worker',
      url: `${process.env.E2E_API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 120000,
      env: {
        E2E_TEST_MODE: 'true',
      },
    },
    {
      command: 'npm run dev:frontend',
      url: process.env.E2E_BASE_URL,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 120000,
      env: { VITE_DEV_PORT: WEB_PORT, VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
