import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Claude in a reader page / a mini lesson exercise (docs/CHAT.md "Claude threads" → "Reader and exercise
 * threads"): the reading view's 💬 opens the PAGE's Claude thread in a sheet (the context chip "📖 Reader ·
 * 小明在巴黎 p.2", the page's chips, Ask only), a chip's question streams a reply (the E2E stand-in), and
 * the thread shows in the Chats tab with its chip, which leads back to that page. The lesson player's 💬
 * opens the exercise's thread ("🧩 Exercise · Translate").
 *
 * CLAUDE_CONTEXT_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */
const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.CLAUDE_CONTEXT_SHOTS;
const FINAL_ZH = '有不懂的词，你可以点一下。';

test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext) {
  const email = `claude-ctx-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  await api(request, '/api/decks', { method: 'POST', token, data: { name: 'HSK 2' } });
  const r = await api<{ reader?: { id: string }; id?: string }>(request, '/api/readers/import', {
    method: 'POST',
    token,
    data: {
      spec: {
        title_chinese: '小明在巴黎',
        title_english: 'Xiaoming in Paris',
        difficulty_level: 'beginner',
        pages: [
          { content_chinese: '小明今天第一次去巴黎。他很兴奋。', content_pinyin: 'Xiǎomíng jīntiān dì yī cì qù Bālí. Tā hěn xīngfèn.', content_english: 'Today Xiaoming is going to Paris for the first time. He is very excited.' },
          { content_chinese: '他喝了一杯咖啡。', content_pinyin: 'Tā hēle yì bēi kāfēi.', content_english: 'He drank a cup of coffee.' },
        ],
      },
    },
  });
  return { token, readerId: r.reader?.id ?? r.id! };
}

/** Into the app, then wait until the device has the reader (the sync). */
async function openReader(page: Page, token: string, readerId: string, path: string) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${token}`);
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('ChineseLearningDB');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                try {
                  const get = open.result.transaction('readers', 'readonly').objectStore('readers').get(id);
                  get.onsuccess = () => {
                    resolve(!!get.result);
                    open.result.close();
                  };
                  get.onerror = () => {
                    resolve(false);
                    open.result.close();
                  };
                } catch {
                  resolve(false);
                  open.result.close();
                }
              };
            }),
          readerId,
        ),
      { timeout: 45_000 },
    )
    .toBe(true);
  await page.goto(path);
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 30_000 });
}

test('📖 Ask Claude about this page: the page thread streams a reply and shows in the Chats tab', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, readerId } = await seed(request);
  await openReader(page, token, readerId, `/readers/${readerId}`);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 2 of 2');
  await page.getByTestId('reader-ask-claude').click();
  const sheet = page.getByTestId('context-claude-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  // The sheet is open over the page: no context chip (the page's own chip is in the Chats tab).
  await expect(sheet.getByTestId('claude-thread-context-chip')).toHaveCount(0);
  await expect(sheet.getByTestId('claude-thread-reader-hint')).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-chip-page_meaning')).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-chip-grammar')).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-chip-quiz')).toBeVisible();
  await expect(sheet.getByTestId('claude-composer-check')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-reader-sheet.png` });

  await sheet.getByTestId('claude-thread-chip-page_meaning').click();
  await expect(sheet.getByTestId('claude-chat-reply').last()).toContainText(FINAL_ZH, { timeout: 25_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-reader-reply.png` });

  // Reopening within 30 minutes continues the same thread.
  await sheet.getByTestId('claude-thread-close').click();
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('reader-ask-claude').click();
  await expect(page.getByTestId('context-claude-sheet').getByTestId('claude-chat-reply').last()).toContainText(FINAL_ZH, { timeout: 15_000 });
  // ⋯ → ＋ New chat; no suggestion chips once the thread has a message.
  await expect(page.getByTestId('claude-thread-chips')).toHaveCount(0);
  await page.getByTestId('claude-thread-more').click();
  await expect(page.getByTestId('context-claude-new')).toBeVisible();
  await page.locator('.claude-chat-menu-backdrop').click({ position: { x: 5, y: 5 } });
  await page.getByTestId('claude-thread-close').click();

  // The Chats tab: the thread with its context emoji, which leads back to the page.
  await page.goto('/chats');
  // The thread's ONE context emoji 📖 → its popover → "Open story ›".
  const chip = page.getByRole('button', { name: 'Reader · 小明在巴黎 p.2 — more' });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-chats-tab.png` });
  await page.getByTestId('chats-context-open').click();
  await expect(page).toHaveURL(new RegExp(`/readers/${readerId}\\?page=2$`));
  await expect(page.getByTestId('study-reader-page-label')).toContainText('Page 2 of 2');
});

test('🧩 Ask Claude on a mini lesson exercise: the exercise thread from the lesson player', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { token, readerId } = await seed(request);
  const created = await api<{ lesson?: { id: string }; id?: string }>(request, '/api/custom-lessons', {
    method: 'POST',
    token,
    data: {
      spec: {
        title: '把字句',
        sections: [
          {
            title: 'Practice',
            exercises: [
              { type: 'translate', english: 'I put the book on the table.', reference_hanzi: '我把书放在桌子上。', reference_pinyin: 'Wǒ bǎ shū fàng zài zhuōzi shang.' },
              { type: 'translate', english: 'Please close the door.', reference_hanzi: '请把门关上。', reference_pinyin: 'Qǐng bǎ mén guān shang.' },
            ],
          },
        ],
      },
    },
  });
  const lessonId = created.lesson?.id ?? created.id!;
  await openReader(page, token, readerId, `/readers/${readerId}`);
  await expect.poll(() => page.evaluate((id) => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('customLessons', 'readonly').objectStore('customLessons').get(id);
        get.onsuccess = () => { resolve(!!get.result); open.result.close(); };
        get.onerror = () => { resolve(false); open.result.close(); };
      } catch { resolve(false); open.result.close(); }
    };
    open.onerror = () => resolve(false);
  }), lessonId), { timeout: 45_000 }).toBe(true);

  await page.goto(`/lessons/${lessonId}/play?from=lessons_page`);
  await page.getByTestId('lesson-ask-claude').click();
  const sheet = page.getByTestId('context-claude-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByTestId('claude-thread-context-chip')).toHaveCount(0);
  await expect(sheet.getByTestId('claude-thread-exercise-hint')).toBeVisible();
  await expect(sheet.getByTestId('claude-thread-chip-explain')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-exercise-sheet.png` });
  await sheet.getByTestId('claude-thread-chip-example').click();
  await expect(sheet.getByTestId('claude-chat-reply').last()).not.toBeEmpty({ timeout: 25_000 });
  await expect(sheet.getByTestId('claude-chat-pending')).toHaveCount(0, { timeout: 25_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-exercise-reply.png` });
});
