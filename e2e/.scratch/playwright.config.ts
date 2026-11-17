import { defineConfig } from '@playwright/test';
process.env.E2E_BASE_URL ||= 'http://localhost:3016';
process.env.E2E_API_URL ||= 'http://localhost:8803';
export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: 'line',
  timeout: 180_000,
  use: { baseURL: process.env.E2E_BASE_URL },
});
