// Call screenshots for the PR (not committed): ONE browser context at a time (the container is short of memory).
import { chromium } from 'playwright';
import fs from 'node:fs';

const API = 'http://localhost:8797';
const WEB = 'http://localhost:3047';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

async function api(path, { method = 'GET', token, data } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const stamp = Date.now();
const seed = async (tag, name) => {
  const email = `shotc-${tag}-${stamp}@test.e2e`;
  const r = await api('/api/test/auth', { method: 'POST', data: { email, name } });
  return { email, token: r.session_token };
};
const tutor = await seed('tutor', 'Minghui');
const student = await seed('student', 'Jerome Swannack');
const rel = await api('/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
await api(`/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
const relId = rel.data.id;
await api('/api/test/call-lesson-report', { method: 'POST', data: { relationship_id: relId, days_ago: 2, report: {
  summary: 'Talked about being ill and seeing a doctor; practised 把 sentences.',
  topics: ['Health & body vocabulary', 'Seeing a doctor', '把 sentences'],
  vocabulary: [
    { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' }, { hanzi: '发烧', pinyin: 'fāshāo', english: 'to have a fever' },
    { hanzi: '咳嗽', pinyin: 'késou', english: 'to cough' }, { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' },
    { hanzi: '嗓子', pinyin: 'sǎngzi', english: 'throat' }, { hanzi: '药', pinyin: 'yào', english: 'medicine' },
  ],
  corrections: [
    { said: '我很头疼', better: '我头很疼', explanation: 'The body part is the subject' },
    { said: '我有发烧', better: '我发烧了', explanation: '发烧 is a verb' },
    { said: '我吃药了把', better: '我把药吃了', explanation: '把 + object before the verb' },
  ],
} } });
await api(`/api/relationships/${relId}/prepared-activities`, { method: 'POST', token: tutor.token, data: {} });
const { call } = await api('/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: relId } });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function inCall(viewport, scale, shots) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${WEB}/?session_token=${tutor.token}`);
  await page.locator('.header').waitFor();
  await page.goto(`${WEB}/calls/${call.id}`);
  await page.getByTestId('join-call').waitFor();
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor();
  await page.waitForTimeout(3000);
  await page.getByLabel('More').click();
  await page.getByTestId('menu-activities').click();
  await page.getByTestId('activity-picker-prepared').locator('[data-prepared="1"]').first().waitFor();
  await shots(page);
  await ctx.close();
}
await inCall({ width: 1280, height: 860 }, 1, async (page) => {
  await page.getByTestId('activity-picker-prepared').locator('.act-prep-peek').nth(1).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/06-desktop-call-activities-menu.png` });
  await page.getByTestId('activity-picker-prepared').locator('[data-prepared="1"]').nth(1).click();
  await page.getByTestId('activity-tile').waitFor();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/07-desktop-running-prepared.png` });
});
await inCall({ width: 412, height: 915 }, 2, async (page) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/08-phone-call-activities-menu.png` });
});
await browser.close();
console.log('done');
