// Screenshots for the PR (not committed). Needs the worker on :8797 (E2E_TEST_MODE) and vite on :3017.
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
  const email = `shot-${tag}-${stamp}@test.e2e`;
  const r = await api('/api/test/auth', { method: 'POST', data: { email, name } });
  return { email, token: r.session_token };
};
const tutor = await seed('tutor', 'Minghui');
const student = await seed('student', 'Jerome Swannack');
const rel = await api('/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
await api(`/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
const relId = rel.data.id;
await api('/api/test/call-lesson-report', { method: 'POST', data: { relationship_id: relId, days_ago: 9, report: {
  summary: 'Breakfast habits and daily routine.', topics: ['Breakfast habits', 'Daily routine'],
  vocabulary: [{ hanzi: '包子', pinyin: 'bāozi', english: 'steamed bun' }, { hanzi: '豆浆', pinyin: 'dòujiāng', english: 'soy milk' }, { hanzi: '起床', pinyin: 'qǐchuáng', english: 'to get up' }],
  corrections: [{ said: '我早饭吃包子', better: '我早饭吃了包子', explanation: 'completed action' }],
} } });
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
await api(`/api/relationships/${relId}/lesson-log`, { method: 'POST', token: tutor.token, data: { lesson_at: new Date(Date.now() - 5 * 86400000).toISOString(), notes: 'Comparisons with 比\n我比他高。今天比昨天冷。' } });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const open = async (token, viewport, scale = 1) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.setDefaultNavigationTimeout(180000);
  await page.goto(`${WEB}/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 60000 });
  return page;
};

const desk = await open(tutor.token, { width: 1280, height: 900 });
if (!process.env.SKIP_PAGE) {
await desk.goto(`${WEB}/connections/${relId}`);
const section = desk.getByTestId('prepared-activities');
await section.waitFor({ timeout: 60000 });
await section.scrollIntoViewIfNeeded();
await section.screenshot({ path: `${OUT}/01-desktop-student-page-empty.png` });
await desk.getByTestId('prepared-make').click();
await desk.getByText('Ready for next lesson: 5 activities').waitFor({ timeout: 60000 });
await section.getByTestId('prepared-row').nth(1).locator('.pa-row-main').click();
await desk.waitForTimeout(400);
await section.screenshot({ path: `${OUT}/02-desktop-ready-for-next-lesson.png` });
const cov = desk.getByTestId('coverage-section');
await cov.scrollIntoViewIfNeeded();
await cov.screenshot({ path: `${OUT}/03-desktop-what-covered.png` });

const phone = await open(tutor.token, { width: 412, height: 915 }, 2);
await phone.goto(`${WEB}/connections/${relId}`);
const ps = phone.getByTestId('prepared-activities');
await ps.waitFor({ timeout: 60000 });
await ps.getByTestId('prepared-row').first().waitFor();
await ps.scrollIntoViewIfNeeded();
await ps.getByTestId('prepared-row').first().locator('.pa-row-main').click();
await phone.waitForTimeout(400);
await ps.screenshot({ path: `${OUT}/04-phone-ready-for-next-lesson.png` });
await phone.getByTestId('coverage-section').scrollIntoViewIfNeeded();
await phone.getByTestId('coverage-section').screenshot({ path: `${OUT}/05-phone-what-covered.png` });
} else { await api(`/api/relationships/${relId}/prepared-activities`, { method: 'POST', token: tutor.token, data: {} }); }

// The call: both join, the tutor opens ⋯ → 🎲 Activities.
const { call } = await api('/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: relId } });
const sp = await open(student.token, { width: 1280, height: 860 });
const join = async (page) => {
  await page.goto(`${WEB}/calls/${call.id}`);
  try { await page.getByTestId('join-call').waitFor({ timeout: 180000 }); } catch (e) { await page.screenshot({ path: `${OUT}/debug-join.png` }); throw e; }
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 60000 });
};
await join(desk);
await join(sp);
await desk.waitForTimeout(2500);
await desk.getByLabel('More').click();
await desk.getByTestId('menu-activities').click();
await desk.getByTestId('activity-picker-prepared').waitFor();
await desk.getByTestId('activity-picker-prepared').locator('.act-prep-peek').nth(1).click();
await desk.waitForTimeout(400);
await desk.screenshot({ path: `${OUT}/06-desktop-call-activities-menu.png` });
await desk.getByTestId('activity-picker-prepared').locator('[data-prepared="1"]').nth(1).click();
await desk.getByTestId('activity-tile').waitFor({ timeout: 30000 });
await desk.waitForTimeout(1500);
await desk.screenshot({ path: `${OUT}/07-desktop-running-prepared-tutor.png` });
await sp.waitForTimeout(500);
await sp.screenshot({ path: `${OUT}/08-desktop-running-prepared-student.png` });

// Phone call menu.
const pc = await open(tutor.token, { width: 412, height: 915 }, 2);
await pc.goto(`${WEB}/calls/${call.id}`);
await pc.getByTestId('join-call').waitFor({ timeout: 60000 });
await pc.getByTestId('record-toggle').uncheck();
await pc.getByTestId('join-call').click();
await pc.getByTestId('call-live').waitFor({ timeout: 60000 });
await pc.waitForTimeout(1500);
await pc.getByLabel('More').click();
await pc.getByTestId('menu-activities').click();
await pc.getByTestId('activity-picker-prepared').waitFor();
await pc.waitForTimeout(400);
await pc.screenshot({ path: `${OUT}/09-phone-call-activities-menu.png` });

await browser.close();
console.log('done', relId);
