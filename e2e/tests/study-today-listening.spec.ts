import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "⚡ Study it today" is ONE rule from everywhere (shared/decks/study-today.ts, docs/STUDY_SESSION.md):
 * Jerome tapped ⚡ in the language explorer opened from the Coach and got all three card types of the word;
 * now one tap on an UNSTARTED word with its clip puts ONLY its listening card in today's session.
 *
 * Coach (the Chats box → 🔍 Explain, stubbed) → tap 银行 → the explorer's Word view → ⚡ Study it today →
 * "⚡ Listening card of 银行 added to today" → Home counts ONE card (not three) → the server's pocket holds
 * the listening card only → the session's card is the listening card.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SENTENCE = '我下午去银行';
const SHOTS = process.env.SHOTS_DIR;

// The phone the app is used on (folded Pixel Fold).
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT'; token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const breakdown = {
  hanzi: SENTENCE,
  pinyin: 'wǒ xiàwǔ qù yínháng',
  translation: 'I’m going to the bank this afternoon.',
  words: [
    { hanzi: '我', pinyin: 'wǒ', gloss: 'I' },
    { hanzi: '下午', pinyin: 'xiàwǔ', gloss: 'afternoon' },
    { hanzi: '去', pinyin: 'qù', gloss: 'go' },
    { hanzi: '银行', pinyin: 'yínháng', gloss: 'bank' },
  ],
  construction: 'Time word before the verb; 去 + place.',
};

test('the explorer’s ⚡ on an unstarted word puts ONLY its listening card in today’s session', async ({ page, request }) => {
  const email = `study-today-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Listening learner' } });
  // A spent budget: nothing new comes today unless ⚡ puts it there.
  await api(request, '/api/profile/study-budget', { method: 'PUT', token, data: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'HSK 2' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes?check=none`, {
    method: 'POST', token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', fun_facts: '银 (yín) silver · 行 (háng) a firm' },
  });

  // E2E makes no TTS: give 银行 its word clip in what the API hands the device, so its listening card can be played.
  const CLIP = 'generated/e2e-yinhang.mp3';
  const withClip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(withClip);
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withClip(x)]));
      if (o.id === note.id && 'audio_url' in o) o.audio_url = CLIP;
      return o;
    }
    return v;
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET' || /\/api\/audio\/|\/api\/claude\/threads/.test(req.url())) return route.fallback();
    const res = await route.fetch();
    const type = res.headers()['content-type'] ?? '';
    if (!type.includes('application/json')) return route.fulfill({ response: res });
    return route.fulfill({ response: res, json: withClip(await res.json()) });
  });
  await page.route('**/api/notes/*/ensure-audio', (route) =>
    route.fulfill({ json: { note: { id: note.id, audio_url: CLIP, updated_at: new Date().toISOString() }, word: 'ok', sentence: 'none' } }));

  // The Coach's Explain (a Claude thread from the Chats box), its result stubbed.
  const now = new Date().toISOString();
  const thread = {
    id: 'conv-listen', client_id: null, title: SENTENCE, context_kind: 'general', context: { kind: 'general' }, badge: { icon: '🔍', text: 'Explain' },
    first_intent: 'explain', preview: SENTENCE, last_message_at: now, created_at: now, unread: 0, pending: false, failed: false, read_only: false,
    archived: false, tutor_visible: null, language: null, source: 'app',
  };
  const message = (id: string, role: 'user' | 'assistant', content_type: string, content: string) => ({
    id, thread_id: 'conv-listen', client_id: null, role, content_type, content, intent: role === 'user' ? 'explain' : null, status: null, streaming: false,
    error: null, answer_lang: null, translation: null, tool_results: null, created_at: now, updated_at: now,
  });
  const payload = {
    thread,
    messages: [message('l1', 'user', 'text', SENTENCE), message('l2', 'assistant', 'analysis', JSON.stringify({ kind: 'explain', breakdown }))],
    server_time: now,
  };
  await page.route('**/api/claude/threads**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname.endsWith('/api/claude/threads')) return route.fulfill({ status: 202, json: payload });
    if (url.pathname.endsWith('/api/claude/threads/conv-listen')) return route.fulfill({ json: payload });
    return route.continue();
  });

  // Sync the deck down; nothing is due (budget 0).
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('HSK 2').first()).toBeVisible({ timeout: 30_000 });
  await page.goto('/');
  await expect(page.locator('.home-study-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('home-bumped')).toHaveCount(0);

  // Chats → the box → 🔍 Explain → 银行 → the explorer's Word view → ⚡.
  await page.goto('/chats');
  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill(SENTENCE);
  await page.getByTestId('claude-composer-explain').click();
  await expect(page.getByTestId('coach-explain-result')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Explore 银行' }).click();
  const word = page.getByRole('dialog', { name: 'The word 银行' });
  await expect(word.getByTestId('explorer-word-card')).toContainText('You have this card in HSK 2');
  await word.getByRole('button', { name: '⚡ Study it today' }).click();
  await expect(page.getByText('⚡ Listening card of 银行 added to today').first()).toBeVisible();
  await expect(word.getByRole('button', { name: '⚡ Listening card today ✓' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-explorer-listening-card.png` });

  // The server's pocket: the listening card only (uploaded at once while online, stored as planned).
  await expect
    .poll(async () => (await api<{ bumps: Array<{ hanzi: string; source: string; card_types: string[] | null }> }>(request, '/api/me/bumps', { token })).bumps
      .map((b) => [b.hanzi, b.source, b.card_types]))
    .toEqual([['银行', 'explorer', ['audio_to_hanzi']]]);

  // Home: ONE card due today — the listening card — not the word's three cards.
  await page.goto('/');
  await expect(page.getByTestId('home-bumped')).toHaveText('⚡ 1 bumped for today', { timeout: 30_000 });
  await expect(page.locator('.home-study-subtitle')).toContainText('1 card due');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-home-one-card.png` });

  // The session's card is the listening card (audio → hanzi: neither the hanzi nor the meaning on the question), ⚡ badge.
  await page.goto('/study?autostart=true');
  await expect(page.getByTestId('study-bump-badge')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.study-fullscreen')).not.toContainText('银行');
  await expect(page.locator('.study-fullscreen')).not.toContainText('bank');
});
