import base from '../playwright.config';
import { defineConfig } from '@playwright/test';
const root = '/home/user/claude-for-language/.claude/worktrees/agent-a59e778a92b065eeb';
export default defineConfig({
  ...base,
  testDir: '../tests',
  reporter: 'line',
  webServer: (base.webServer as Array<Record<string, unknown>>).map((w) => ({ ...w, cwd: root })),
  use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } },
});
