import { test, expect, APIRequestContext, Page, Route } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

/**
 * A read card's take checked by Claude (docs/STUDY_SESSION.md "You said" → "Read takes checked by Claude";
 * shared/study/readTakeCheck.ts). Jerome, Nov 2026: the card 我越学中文，越觉得英文很繁琐。 read aloud came back as
 * 我越学中文，越觉得英语很"繁琐"。 and the box said a flat "✕ Didn't match". Now:
 * - only the recogniser's quote marks differing → ✓ Match on the device, the quotes not shown, no Claude call;
 * - 英语 for 英文 → "Checking…" (never the bare ✗), then the worker's read-aloud check (its E2E stand-in,
 *   services/answer-check-fake.ts — hermetic) → ≈ Close with the reason;
 * - Hard mode's question: checking → ≈ Nearly with Claude's card.
 */
test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: process.env.SHOTS_DIR ? 2 : 1,
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
});

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const CARD = '我越学中文，越觉得英文很繁琐。';
const PINYIN = 'wǒ yuè xué Zhōngwén, yuè juéde Yīngwén hěn fánsuǒ.';
const ENGLISH = 'The more I study Chinese, the more I find English to be complicated.';
const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** A new account with the one sentence card, only its read card in the queue; takes upload and hear `heard`. */
async function setUp(page: Page, request: APIRequestContext, heard: string, hardMode: 'off' | 'all') {
  await skipFirstCardExplainer(page.context());
  await page.addInitScript((mode) => { try { localStorage.setItem('sentence-gate-v1', mode); } catch { /* ignore */ } }, hardMode);
  await page.route('**/api/transcribe/live', (route) => route.fulfill({ json: { provider: 'upload' } }));
  await page.route(/\/api\/transcribe$/, (route) => route.fulfill({ json: { text: heard, language: 'zh', provider: 'e2e' } }));
  await page.route('**/api/notes/*/ensure-audio', (route) => route.abort());
  await page.route('**/api/sentences/top-up', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"queued":0,"note_ids":[]}' }));
  const email = `read-take-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Read take' } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'Core Homework' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token, data: { hanzi: CARD, pinyin: PINYIN, english: ENGLISH },
  });
  await api(request, '/api/me/card-holds', { method: 'POST', token, data: { note_ids: [note.id], card_types: ['meaning_to_hanzi', 'audio_to_hanzi'], kind: 'suspend' } });
  // Claude's read-aloud check goes to the worker (its stand-in), held until released so "Checking…" can be seen.
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const checks: Array<Record<string, unknown>> = [];
  await page.route('**/api/lessons/answer-check', async (route: Route) => {
    checks.push(route.request().postDataJSON());
    await held;
    await route.continue();
  });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('Core Homework').first()).toBeVisible({ timeout: 30000 });
  const record = page.getByRole('button', { name: 'Record Your Pronunciation' });
  await expect(async () => {
    await page.goto(`/study?deck=${deck.id}&autostart=true`);
    await expect(record).toBeVisible({ timeout: 10000 });
  }).toPass({ timeout: 90000 });
  await record.click();
  const stop = page.getByRole('button', { name: 'Stop Recording' });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await stop.click();
  await page.getByRole('button', { name: 'Check Answer' }).click();
  return { release, checks };
}

test('only the recogniser\'s quote marks differ: ✓ Match on the device, quotes not shown, no Claude call', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { checks } = await setUp(page, request, '我越学中文，越觉得英文很"繁琐"。', 'off');
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  const box = page.getByTestId('you-said');
  await expect(box).toHaveAttribute('data-state', 'match', { timeout: 15000 });
  await expect(page.getByTestId('you-said-verdict')).toHaveText('Match');
  await expect(page.getByTestId('you-said-hanzi')).toHaveText(CARD);
  await expect(page.getByTestId('you-said-pinyin')).not.toContainText('"');
  await shot(page, 'read-take-01-quotes-match');
  // No ▶ pinned to the box's side (docs/STUDY_SESSION.md "The study card's layout"): the take is in ⋯.
  await expect(box.getByTestId('you-said-play')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Play my recording/ })).toBeVisible();
  await page.waitForTimeout(800);
  expect(checks).toHaveLength(0);
});

test('英语 for 英文: Checking… instead of ✗, then ≈ Close with Claude\'s reason', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { release, checks } = await setUp(page, request, '我越学中文，越觉得英语很"繁琐"。', 'off');
  await expect(page.getByTestId('study-card-back')).toBeVisible();
  const box = page.getByTestId('you-said');
  await expect(box).toHaveAttribute('data-state', 'checking', { timeout: 15000 });
  await expect(page.getByTestId('you-said-verdict')).toContainText('Checking…');
  await expect(box).not.toContainText('Didn’t match');
  await expect(page.getByTestId('you-said-hanzi')).toHaveText('我越学中文，越觉得英语很繁琐。');
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ exercise_type: 'read_aloud', input: 'spoken', model_answer: CARD, answer: '我越学中文，越觉得英语很繁琐。', prompt_en: ENGLISH });
  await shot(page, 'read-take-02-checking');
  release();
  await expect(box).toHaveAttribute('data-state', 'close', { timeout: 15000 });
  await expect(page.getByTestId('you-said-verdict')).toHaveText('Close');
  // ONE short line from the diff against the card (docs/STUDY_SESSION.md "Answer feedback: one line and a diff").
  await expect(page.getByTestId('you-said-reason')).toHaveText('语 instead of 文');
  await expect(page.getByTestId('you-said-diff').locator('[data-kind="wrong"]')).toHaveText('语');
  await shot(page, 'read-take-03-close');
});

test('Hard mode: the read take is checking on the question, then ≈ Nearly with Claude\'s card', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { release } = await setUp(page, request, '我越学中文，越觉得英语很"繁琐"。', 'all');
  const feedback = page.getByTestId('hard-feedback');
  await expect(feedback).toHaveAttribute('data-result', 'checking', { timeout: 15000 });
  await expect(feedback).toContainText('Checking…');
  await shot(page, 'read-take-04-hard-checking');
  release();
  await expect(feedback).toHaveAttribute('data-result', 'close', { timeout: 15000 });
  // Slim: Claude's verdict as the line's chip, what differs, his take marked — no explanation.
  await expect(page.getByTestId('hard-sentence-check')).toBeVisible();
  await expect(page.getByTestId('answer-diff-line')).toHaveText('≈ Almost · 语 instead of 文');
  await expect(feedback).not.toContainText('same meaning');
  await expect(page.getByTestId('hard-try-again')).toBeVisible();
  await shot(page, 'read-take-05-hard-close');
});
