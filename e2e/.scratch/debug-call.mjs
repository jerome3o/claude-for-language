import { chromium } from 'playwright';
const API = 'http://localhost:8797';
const WEB = 'http://localhost:3047';
const OUT = process.argv[2];
async function api(path, { method = 'GET', token, data } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}
const r = await api('/api/test/auth', { method: 'POST', data: { email: `dbg-${Date.now()}@test.e2e`, name: 'Dbg' } });
const { call } = await api('/api/calls', { method: 'POST', token: r.session_token, data: {} });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 500)));
page.setDefaultTimeout(240000);
page.setDefaultNavigationTimeout(240000);
await page.goto(`${WEB}/?session_token=${r.session_token}`);
await page.locator('.header').waitFor();
await page.goto(`${WEB}/calls/${call.id}`);
await page.waitForTimeout(60000);
await page.screenshot({ path: `${OUT}/debug-call.png` });
console.log(await page.locator('body').innerText().then((t) => t.slice(0, 500)));
await browser.close();
