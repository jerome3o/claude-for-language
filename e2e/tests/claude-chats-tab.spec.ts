import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"), web: the people
 * first (the unread tutor chat on top), a thin divider, then the Claude threads — compact one-line rows,
 * no previews, no filter chips; a card thread's ONE context emoji 📇 → a popover "Asked on card · 银行"
 * + "Open card ›" (→ the card); the box at the bottom always goes to Claude (✏️ Check · 🔍 Explain for
 * Chinese only once there is text) and the reply streams into the new thread; More → "Ask Claude /
 * Coach" and /coach land on the box; the tutor's view has the same layout.
 *
 * CHATS_TAB_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CHATS_TAB_SHOTS;
const FINAL = '有不懂的词，你可以点一下。';

interface Seeded { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  expect(res.ok(), `${path} ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string, role?: 'tutor'): Promise<Seeded> {
  const email = `chats-tab-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name, ...(role ? { role } : {}) } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, user: Seeded, path: string, viewport = { width: 412, height: 915 }): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.goto(path);
  return page;
}

async function seedPair(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', 'Minghui', 'tutor');
  const me = await seedUser(request, 'me', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: me.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: me.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${rel.data.id}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  return { tutor, me, relId: rel.data.id, convId: conv.id };
}

test.describe('Chats tab — people and Claude in one list', () => {
  test('the learner: sections, the context popover, the box sends to Claude and the reply streams', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const { tutor, me, convId } = await seedPair(request);
    const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: me.token, data: { name: 'HSK 2' } });
    const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: me.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' } });
    // Two Claude chats: a question on the 银行 card and a sentence he had checked.
    await api(request, '/api/claude/threads', { method: 'POST', token: me.token, data: { client_id: `e2e-card-${Date.now()}`, context: { kind: 'card', note_id: note.id }, intent: 'ask', text: '银行的“行”为什么读 háng？' } });
    await api(request, '/api/claude/threads', { method: 'POST', token: me.token, data: { client_id: `e2e-check-${Date.now()}`, context: { kind: 'general' }, intent: 'check', text: '我昨天去了商店买东西了' } });
    // Then his tutor writes (unread → on top).
    await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: tutor.token, data: { content: '明天上课见！别忘了带作业。' } });

    const page = await openAs(browser, me, '/chats');
    const tutorRow = page.locator('[data-testid="chats-item"][data-kind="tutor"]');
    await expect(tutorRow).toContainText('Minghui', { timeout: 30000 });
    const claudeRows = page.locator('[data-testid="chats-item"][data-kind="claude"]');
    await expect(claudeRows).toHaveCount(2, { timeout: 30000 });
    // People first, the divider, then Claude; no previews, no filter chips, no "To:".
    await expect(page.getByTestId('chats-item').first()).toHaveAttribute('data-kind', 'tutor');
    await expect(page.getByTestId('chats-people').getByTestId('chats-item')).toHaveCount(1);
    await expect(page.getByTestId('chats-divider')).toBeVisible();
    await expect(page.getByText('明天上课见！别忘了带作业。')).toHaveCount(0);
    await expect(page.getByTestId('chats-filter-all')).toHaveCount(0);
    await expect(page.getByTestId('chats-compose-to')).toHaveCount(0);
    // Let both replies land so the rows read as finished.
    await expect(page.getByTestId('chats-row-status')).toHaveCount(0, { timeout: 30000 });
    // Rows are compact: one line, ~60px.
    const box = await claudeRows.first().boundingBox();
    expect(box!.height).toBeLessThanOrEqual(66);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-learner-list.png` });

    // The context emoji: a popover with the full text, then "Open card ›" opens the card.
    await page.getByRole('button', { name: 'Asked on card · 银行 — more' }).click();
    await expect(page.getByTestId('chats-context-pop')).toContainText('Asked on card · 银行');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-context-popover.png` });
    await page.getByTestId('chats-context-open').click();
    await expect(page).toHaveURL(new RegExp(`/cards/${note.id}$`));
    await page.goto('/chats');

    // The box: idle = Type · Say it, no Check / Explain; typed Chinese → Ask · ✏️ Check · 🔍 Explain.
    await expect(page.getByTestId('claude-chat-voice-say')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('claude-composer-check')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-composer-idle.png` });
    await page.getByTestId('claude-chat-voice-type').click();
    await expect(page.getByTestId('claude-composer-check')).toHaveCount(0);
    await page.getByTestId('claude-chat-voice-text').fill('这个周末你想做什么？');
    await expect(page.getByTestId('claude-composer-check')).toBeVisible();
    await expect(page.getByTestId('claude-composer-explain')).toBeVisible();
    await expect(page.getByTestId('claude-chat-voice-submit')).toContainText('Ask');
    if (SHOTS) await page.getByTestId('chats-compose').scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-composer-chinese.png` });
    await page.getByTestId('claude-chat-voice-submit').click();
    await expect(page).toHaveURL(/\/chats\/claude\/(?!new)[^/?]+/, { timeout: 15_000 });
    await expect(page.getByTestId('claude-chat-reply').last()).toContainText(FINAL, { timeout: 25_000 });
    // Back → the Chats tab, with the new chat in the list.
    await page.getByTestId('claude-thread-back').click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('chats-claude-row').filter({ hasText: '这个周末你想做什么' })).toBeVisible({ timeout: 20_000 });
    if (SHOTS) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: `${SHOTS}/05-learner-list-dark.png` });
    }
    await page.context().close();
  });

  test('More → Ask Claude / Coach and /coach land on the box', async ({ browser, request }) => {
    test.setTimeout(90_000);
    const me = await seedUser(request, 'solo', 'Jerome');
    const page = await openAs(browser, me, '/more');
    await page.getByRole('link', { name: /Ask Claude \/ Coach/ }).click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('claude-chat-voice-text')).toBeFocused();
    await page.goto(`/coach?text=${encodeURIComponent('我去了')}`);
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.getByTestId('claude-chat-voice-text')).toHaveValue('我去了');
    await expect(page.getByTestId('claude-composer-check')).toBeEnabled();
    await page.context().close();
  });

  test('the tutor: the same layout — students, the divider, her Claude chats; a box without Check', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const { tutor, me, convId } = await seedPair(request);
    await api(request, `/api/conversations/${convId}/messages`, { method: 'POST', token: me.token, data: { content: '老师好！作业做完了。' } });
    await api(request, '/api/claude/threads', { method: 'POST', token: tutor.token, data: { client_id: `e2e-t-${Date.now()}`, context: { kind: 'general' }, intent: 'ask', text: '怎么给初学者解释“了”？' } });
    const page = await openAs(browser, tutor, '/chats');
    const student = page.locator('[data-testid="chats-item"][data-kind="student"]');
    await expect(student).toContainText('Jerome', { timeout: 30000 });
    await expect(page.getByTestId('chats-people')).toHaveAttribute('aria-label', 'Students');
    await expect(page.getByTestId('chats-claude-row')).toHaveCount(1, { timeout: 30000 });
    await expect(page.getByTestId('chats-divider')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-tutor-view.png` });
    await page.getByTestId('claude-chat-voice-type').click();
    await page.getByTestId('claude-chat-voice-text').fill('这个句子对吗？');
    await expect(page.getByTestId('claude-composer-check')).toHaveCount(0);
    await page.context().close();

    if (SHOTS) {
      const wide = await openAs(browser, tutor, '/chats', { width: 1280, height: 900 });
      await expect(wide.locator('[data-testid="chats-item"][data-kind="student"]')).toBeVisible({ timeout: 30000 });
      await wide.screenshot({ path: `${SHOTS}/07-tutor-view-desktop.png` });
      await wide.context().close();
    }
  });
});
