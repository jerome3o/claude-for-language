import base from '../playwright.config';
export default {
  ...base,
  testDir: '../tests',
  reporter: 'line',
  use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } },
  webServer: (base.webServer as any[]).map((w) => ({ ...w, cwd: '../..' })),
};
