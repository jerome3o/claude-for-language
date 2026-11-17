import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from '../tests/fixtures/explainer';

const SHOTS = process.env.SHOTS_DIR!;
const P = process.env.PREFIX ?? 'after';
const W = Number(process.env.VW ?? 412);
test.use({
  viewport: { width: W, height: 915 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});
const shot = async (page: Page, name: string, wait = 450) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${SHOTS}/${P}-${name}.png` });
};
const API = process.env.E2E_API_URL || 'http://localhost:8803';
async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
const FAKE_WS = 'wss://fake-soniox.test/transcribe-websocket';
async function fakeSoniox(page: Page) {
  await page.addInitScript((fakeUrl) => {
    const Real = window.WebSocket;
    class FakeSoniox extends EventTarget {
      readyState = 0;
      onopen: ((e: Event) => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      private configured = false;
      private chunks = 0;
      constructor(public url: string) { super(); setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 20); }
      private heard() { return (window as unknown as { __heard?: string }).__heard ?? ''; }
      private reply(o: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(o) })); }
      send(data: unknown) {
        if (!this.configured) { this.configured = true; return; }
        if (data !== '') { this.chunks++; if (this.chunks === 2) this.reply({ tokens: [{ text: this.heard(), is_final: false }] }); return; }
        setTimeout(() => { this.reply({ tokens: [{ text: this.heard(), is_final: true }, { text: '<fin>', is_final: true }] }); this.reply({ tokens: [], finished: true }); }, 30);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      return String(url) === fakeUrl ? new FakeSoniox(String(url)) : new Real(url, protocols);
    } as unknown as typeof WebSocket;
  }, FAKE_WS);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: {
    provider: 'soniox', api_key: 'snx_temp_e2e', expires_at: new Date(Date.now() + 1800e3).toISOString(),
    websocket_url: FAKE_WS, model: 'stt-rt-v5', language_hints: ['zh', 'en'],
  } }));
}
const heard = { text: '' };
async function hear(page: Page, text: string) {
  heard.text = text;
  await page.evaluate((h) => { (window as unknown as { __heard?: string }).__heard = h; }, text);
}
const CLUE = { hanzi: '我最喜欢吃虾饺。', pinyin: 'Wǒ zuì xǐhuan chī xiājiǎo.', translation: 'I like shrimp dumplings best.' };
const SET = [
  { hanzi: '这家店的虾饺很好吃。', pinyin: 'Zhè jiā diàn de xiājiǎo hěn hǎochī.', translation: 'The har gow at this place is delicious.' },
  { hanzi: '我们点一笼虾饺吧。', pinyin: 'Wǒmen diǎn yì lóng xiājiǎo ba.', translation: 'Let’s order a basket of har gow.' },
  { hanzi: '早茶一定要吃虾饺。', pinyin: 'Zǎochá yídìng yào chī xiājiǎo.', translation: 'You have to eat har gow at dim sum.' },
  { hanzi: '虾饺的皮是透明的。', pinyin: 'Xiājiǎo de pí shì tòumíng de.', translation: 'The skin of har gow is see-through.' },
];
async function seed(page: Page, request: APIRequestContext, keep: string, hardMode: 'off' | 'all') {
  await skipFirstCardExplainer(page.context());
  await fakeSoniox(page);
  await page.addInitScript((m) => { try { localStorage.setItem('sentence-gate-v1', m); } catch { /* */ } }, hardMode);
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard.text, language: 'zh', provider: 'e2e' } }));
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ json: { queued: 0, note_ids: [] } }));
  const email = `shots-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Core Homework' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, { method: 'POST', token, data: {
    hanzi: '虾饺', pinyin: 'xiā jiǎo', english: 'shrimp dumpling (har gow)',
    fun_facts: '虾 (xiā) shrimp · 饺 (jiǎo) dumpling. A Cantonese dim sum classic with a translucent wheat-starch skin.',
    sentence_clue: CLUE.hanzi, sentence_clue_pinyin: CLUE.pinyin, sentence_clue_translation: CLUE.translation,
  } });
  const others = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'].filter((t) => t !== keep);
  await api(request, '/api/me/card-holds', { method: 'POST', token, data: { note_ids: [note.id], card_types: others, kind: 'suspend' } });
  await page.route(`**/api/notes/${note.id}/sentences`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const now = new Date().toISOString();
    await route.fulfill({ json: { sentences: SET.map((x, i) => ({ id: `s${i}`, note_id: note.id, position: i, ...x, audio_url: null, focus: 'core', focus_note: null, explanation: null, created_at: now, updated_at: now })) } });
  });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Core Homework').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(page.getByText('Core Homework').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(page.getByTestId('study-card-front').or(page.locator('.study-card-main')).first()).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60000 });
}
async function takeRead(page: Page, text: string) {
  await hear(page, text);
  await page.getByRole('button', { name: 'Record Your Pronunciation' }).click();
  const stop = page.getByRole('button', { name: 'Stop Recording' });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await stop.click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
}

test('read card', async ({ page, request }) => {
  await seed(page, request, 'hanzi_to_meaning', 'off');
  await expect(page.getByRole('button', { name: 'Record Your Pronunciation' })).toBeVisible({ timeout: 15000 });
  await shot(page, `w${W}-01-read-question`);
  await takeRead(page, '虾饺');
  await expect(page.getByTestId('you-said')).toHaveAttribute('data-state', 'match', { timeout: 15000 });
  await shot(page, `w${W}-02-read-answer`, 900);
  if (W > 600) return;
  await page.getByRole('button', { name: 'More actions' }).click();
  await shot(page, '03-more-menu');
  await page.keyboard.press('Escape');
  if (await page.locator('.study-sheet-backdrop').isVisible().catch(() => false)) await page.locator('.study-sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
  const list = page.getByTestId('sentence-set').first();
  await list.scrollIntoViewIfNeeded();
  await page.locator('.study-card-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await shot(page, '04-sentences-collapsed');
  const rows = page.locator('.sentence-set-row');
  await rows.nth(1).locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
  await rows.nth(2).locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
  await rows.nth(2).locator('.sentence-set-hidden, .sentence-set-reveal').first().click();
  await shot(page, '05-sentences-half-revealed');
});

test('meaning card typed right', async ({ page, request }) => {
  test.skip(W > 600);
  await seed(page, request, 'meaning_to_hanzi', 'off');
  await expect(page.getByText('shrimp dumpling (har gow)').first()).toBeVisible({ timeout: 15000 });
  const type = page.getByRole('button', { name: /Type/ }).first();
  if (await type.isVisible().catch(() => false)) await type.click();
  await page.locator('textarea, input[type="text"]').first().fill('虾饺');
  await shot(page, '06-meaning-question');
  await page.getByRole('button', { name: /Check/ }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '07-meaning-right-moment', 0);
  await shot(page, '08-meaning-answer', 1200);
});

test('hard mode right', async ({ page, request }) => {
  test.skip(W > 600);
  await seed(page, request, 'hanzi_to_meaning', 'all');
  await takeRead(page, '虾饺');
  await expect(page.getByTestId('hard-feedback')).toHaveAttribute('data-result', 'right', { timeout: 15000 });
  await page.waitForTimeout(150);
  await shot(page, '09-hard-question-right', 0);
  await expect(page.getByTestId('sentence-round')).toBeVisible({ timeout: 15000 });
  const ex = page.getByTestId('sentence-round-exercise').first();
  const target = (await ex.getAttribute('data-mode')) === 'read' ? await ex.locator('[lang="zh-CN"], .hanzi').first().innerText().catch(() => '') : '';
  const all = [CLUE, ...SET];
  const pick = all.find((s) => target.includes(s.hanzi.slice(0, 3)))?.hanzi ?? all[0].hanzi;
  await hear(page, pick);
  await ex.getByTestId('sentence-practise-mic').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('sentence-stop-recording').click();
  await page.waitForTimeout(500);
  await shot(page, '10-round-exercise-said', 0);
});
