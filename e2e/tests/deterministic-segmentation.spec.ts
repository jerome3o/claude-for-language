import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { skipFirstCardExplainer } from './fixtures/explainer';

// The first-card explainer is not what these tests are about (fixtures/explainer.ts).
test.beforeEach(async ({ context }) => skipFirstCardExplainer(context));

/**
 * Word chips without an LLM (docs/LANGUAGE_EXPLORER.md "Word chips without an LLM";
 * shared/chinese/segment.ts): Claude's Chinese reply in Ask Claude (the card's Claude thread)
 * arrives with no words and is shown as WORD chips straight away — 银行, 地方, 我们 are one chip
 * each, never one per character — made on the device by the deterministic segmenter; the old
 * Claude splitter (/api/note-questions/:id/words) is never called. Pinyin on → each word carries
 * its pinyin; a tap opens the language explorer on the word.
 *
 * Claude's answer is replaced at the network edge (page.route on /api/claude/threads*); the real
 * worker handles sign-in, the deck and the sync.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const QUESTION = '这个词的相反是什么';
const ANSWER = '好问题！\n「工资高」的相反是「工资低」。\n比如：这份工作的工资低，我不想做。\n银行就是放钱的地方。我们明天去银行。\n你要不要我帮你加一张「工资低」的卡片？';

async function fakeClaude(page: Page, wordsCalls: string[]) {
  const T = '2026-11-03T10:00:00.000Z';
  let saved: { thread: Record<string, unknown>; messages: Record<string, unknown>[] } | null = null;
  const summary = (id: string, clientId: string, noteId: string) => ({
    id, client_id: clientId, title: QUESTION, context_kind: 'card', context: { kind: 'card', note_id: noteId, label: '工资' }, badge: { icon: '📇', text: 'Asked on card · 工资' },
    first_intent: 'ask', preview: ANSWER.slice(0, 40), last_message_at: T, created_at: T, unread: 0, pending: false, failed: false, read_only: false, archived: false,
    tutor_visible: null, language: 'zh', source: 'app',
  });
  const message = (id: string, role: 'user' | 'assistant', content: string, clientId: string | null) => ({
    id, thread_id: 'seg-thread', client_id: clientId, role, content_type: 'text', content, intent: role === 'user' ? 'ask' : null, status: null, streaming: false, error: null,
    answer_lang: role === 'assistant' ? 'zh' : null, translation: null, tool_results: null, auto_check: null, created_at: T, updated_at: T,
  });
  await page.route('**/api/claude/threads**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'GET' && path.endsWith('/api/claude/threads')) {
      return route.fulfill({ json: { threads: saved ? [saved.thread] : [], deleted_ids: [], server_time: T } });
    }
    if (req.method() === 'POST' && path.endsWith('/api/claude/threads')) {
      const body = JSON.parse(req.postData() || '{}') as { client_id: string; message_client_id: string; text: string; context: { note_id: string } };
      saved = { thread: summary('seg-thread', body.client_id, body.context.note_id), messages: [message('seg-q', 'user', body.text, body.message_client_id), message('seg-a', 'assistant', ANSWER, null)] };
      return route.fulfill({ status: 202, json: saved });
    }
    if (req.method() === 'GET' && saved && path.endsWith('/api/claude/threads/seg-thread')) {
      return route.fulfill({ json: { ...saved, server_time: T } });
    }
    return route.continue();
  });
  await page.route('**/api/note-questions/*/words', async (route) => {
    wordsCalls.push(route.request().url());
    await route.fulfill({ json: { words: null, cached: false } });
  });
}

test('Ask Claude reply: multi-character word chips at once, no Claude splitter', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `seg-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: '工资练习' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token, data: { hanzi: '工资', pinyin: 'gōngzī', english: 'salary', fun_facts: '工 (gōng) work · 资 (zī) money' } });

  const wordsCalls: string[] = [];
  await fakeClaude(page, wordsCalls);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(`/decks?session_token=${token}`);
  await expect(page.getByText('工资练习').first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);

  const skip = page.getByTestId('skip-recording');
  await expect(skip).toBeVisible({ timeout: 30000 });
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(500);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await skip.click();
  await expect(page.getByTestId('study-card-back')).toBeVisible();

  await page.getByRole('button', { name: 'Ask Claude' }).click();
  const sheet = page.getByTestId('ask-claude-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('claude-chat-voice-type').click(); // voice first: ✏️ Type opens the box
  await sheet.getByTestId('claude-chat-voice-text').fill(QUESTION);
  await sheet.getByTestId('claude-chat-voice-submit').click();

  const reply = sheet.getByTestId('claude-chat-reply');
  await expect(reply.getByTestId('chat-words')).toBeVisible();
  const chips = reply.locator('.chat-word');
  for (const word of ['问题', '工资', '相反', '银行', '地方', '我们', '明天', '要不要', '卡片']) {
    await expect(chips.filter({ hasText: new RegExp(`^${word}$`) }).first()).toBeVisible();
  }
  // Words, not characters: most chips hold two or more characters' worth of the reply.
  const texts = await chips.allTextContents();
  expect(texts.filter((t) => Array.from(t).length >= 2).length).toBeGreaterThanOrEqual(12);
  expect(texts).not.toContain('银');
  // My own question is word chips too.
  await expect(sheet.getByTestId('claude-chat-mine').locator('.chat-word', { hasText: '相反' })).toBeVisible();
  if (process.env.SHOOT) await page.screenshot({ path: '../docs/pr-screenshots/deterministic-segmentation/web-02-after.png' });

  // A tap opens the explorer on the whole word.
  await chips.filter({ hasText: /^银行$/ }).first().click();
  const explorer = page.getByTestId('explorer');
  await expect(explorer).toBeVisible();
  await expect(explorer).toContainText('银行');
  if (process.env.SHOOT) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/pr-screenshots/deterministic-segmentation/web-03-explorer.png' });
  }
  await page.getByTestId('explorer-close').click();
  await expect(explorer).toBeHidden();


  // Pinyin on (long-press menu → Pinyin): each word with its own pinyin.
  const bubble = reply.locator('.chat-bubble');
  const box = (await bubble.boundingBox())!;
  const init = { clientX: box.x + 12, clientY: box.y + 12, pointerType: 'touch', pointerId: 5, isPrimary: true, bubbles: true };
  await bubble.dispatchEvent('pointerdown', init);
  await page.waitForTimeout(650);
  await bubble.dispatchEvent('pointerup', init);
  await page.getByTestId('message-menu').locator('[data-tool="pinyin"]').click();
  await expect(reply.locator('rt', { hasText: 'yínháng' }).first()).toBeVisible();
  if (process.env.SHOOT) await page.screenshot({ path: '../docs/pr-screenshots/deterministic-segmentation/web-04-pinyin.png' });

  expect(wordsCalls).toEqual([]);
});
