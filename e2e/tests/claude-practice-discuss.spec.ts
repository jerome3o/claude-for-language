import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Practice with Claude + Discuss with Claude as Claude threads (docs/CHAT.md "Practice with Claude",
 * "Discuss with Claude"), web:
 * - Chats → ✏️ → 🎭 Practice a situation… → a preset → ▶ Start: a practice thread, Claude speaks first
 *   (the worker's E2E stand-in streams a waiter's line in three chunks), the help chips, the roles line;
 *   his answer gets the next line.
 * - A tutor's chat message → the message menu → Discuss with Claude: the message's Claude thread in a
 *   sheet over the chat (the quote, the chat-message chips), the answer streamed; opening it again
 *   resumes the same thread.
 *
 * CLAUDE_PRACTICE_SHOTS=<dir> also saves screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CLAUDE_PRACTICE_SHOTS;
const OPENER_END = '这是菜单，您想吃点什么？';
const EN_FINAL = '(E2E) Claude streams this answer in three parts.';

test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  expect(res.ok(), `${path} ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `practice-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

async function openAs(browser: Browser, user: SeededUser, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30_000 });
  await page.goto(path);
  return page;
}

test('Practice a situation: Claude opens the scene (streamed), the help chips, the next line', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const me = await seedUser(request, 'learner', 'Jerome');
  const page = await openAs(browser, me, '/chats');
  await expect(page.getByTestId('chats-compose')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByTestId('chats-new-practice').click();
  await expect(page.getByTestId('practice-sheet')).toBeVisible();
  await page.getByTestId('practice-preset-restaurant').click();
  await expect(page.getByTestId('practice-scenario')).toHaveValue('在饭店点菜');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-01-practice-sheet.png` });
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/chats\/claude\/(?!new)[^/?]+\?source=practice$/, { timeout: 15_000 });

  // Claude speaks first: the waiter's line grows, then the whole of it.
  await expect(page.getByTestId('claude-thread-context-chip')).toContainText('Practice · 在饭店点菜');
  await expect(page.getByTestId('claude-thread-roles')).toContainText('Claude plays 服务员');
  const reply = page.getByTestId('claude-chat-reply').last();
  await expect(reply).toContainText(OPENER_END, { timeout: 20_000 });
  await expect(page.getByTestId('claude-thread-chip-hint')).toBeVisible();
  await expect(page.getByTestId('claude-thread-chip-say')).toBeVisible();
  await expect(page.getByTestId('claude-thread-chip-correct')).toBeVisible();
  // Ask only: a role-play has no ✏️ Check / 🔍 Explain.
  await expect(page.getByTestId('claude-composer-check')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-02-practice-thread.png` });

  // His line → the next one.
  await page.getByTestId('claude-chat-voice-type').click();
  await page.getByTestId('claude-chat-voice-text').fill('两位，谢谢。');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('claude-chat-reply')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId('claude-chat-reply').last()).toContainText(OPENER_END, { timeout: 20_000 });

  // The Chats tab lists it as a Claude row with the 🎭 chip.
  await page.goto('/chats');
  await expect(page.getByTestId('chats-claude-row').first()).toContainText('Practice', { timeout: 20_000 });
  await page.context().close();
});

test('Discuss with Claude on a chat message: the message’s thread in a sheet, resumed next time', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  await api(request, `/api/conversations/${conv.id}/messages`, { method: 'POST', token: tutor.token, data: { content: '明天下午三点见，别迟到！' } });

  const page = await openAs(browser, student, `/connections/${relId}/chat/${conv.id}`);
  const bubble = page.getByTestId('chat-message').filter({ hasText: '别迟到' }).locator('.chat-bubble');
  await expect(bubble).toBeVisible({ timeout: 30_000 });
  await bubble.click({ button: 'right' });
  await page.getByTestId('message-menu').locator('[data-tool="discuss"]').click();

  const sheet = page.getByTestId('discuss-claude-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('discuss-claude-quote')).toHaveText('明天下午三点见，别迟到！');
  await expect(sheet.getByTestId('claude-thread-chip-meaning')).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-chip-cards')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-03-discuss-sheet.png` });
  await sheet.getByTestId('claude-thread-chip-meaning').click();
  await expect(sheet.getByTestId('claude-chat-reply').last()).toContainText(EN_FINAL, { timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-04-discuss-answer.png` });

  // Closed and opened again: the same thread (the answer is there, no new one).
  await sheet.getByTestId('claude-thread-close').click();
  await expect(sheet).toHaveCount(0);
  await bubble.click({ button: 'right' });
  await page.getByTestId('message-menu').locator('[data-tool="discuss"]').click();
  await expect(page.getByTestId('discuss-claude-sheet').getByTestId('claude-chat-reply')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('discuss-claude-sheet').getByTestId('claude-chat-reply').last()).toContainText(EN_FINAL);
  await page.context().close();
});
