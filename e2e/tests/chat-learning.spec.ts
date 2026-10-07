import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Learning tools in the chat (docs/CHAT.md PR 3), web: word chips + the word
 * sheet, 拼 / EN toggles, "Make flashcards" (pick → review → one batch add),
 * the tutor's correction (a real PUT) seen by the student as a diff, and
 * "Check my Chinese" before sending. Claude's calls (words, propose, coach)
 * need ANTHROPIC_API_KEY, which is not set locally — they are mocked with
 * page.route.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; data?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as T };
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `chatlearn-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.body.user.id, email, token: r.body.session_token };
}

async function seedChat(request: APIRequestContext) {
  const tutor = await seedUser(request, 'tutor', '王明慧');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST',
    token: tutor.token,
    data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.body.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const conv = await api<{ id: string }>(request, `/api/relationships/${relId}/conversations`, { method: 'POST', token: tutor.token, data: {} });
  return { tutor, student, relId, convId: conv.body.id };
}

async function say(request: APIRequestContext, user: SeededUser, convId: string, content: string) {
  const r = await api<{ id: string; created_at: string }>(request, `/api/conversations/${convId}/messages`, {
    method: 'POST',
    token: user.token,
    data: { content },
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function openAs(
  browser: Browser,
  user: SeededUser,
  path: string,
  viewport = { width: 412, height: 915 },
  setup?: (page: Page) => Promise<void>,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    try {
      localStorage.setItem('chat-notify-nudge-dismissed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(`/?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  if (setup) await setup(page);
  await page.goto(path);
  return page;
}

/** No Claude locally: the lazy words call answers "busy" (the message stays plain text). */
async function noWords(page: Page) {
  await page.route('**/api/messages/*/words', (route) => route.fulfill({ status: 503, json: { error: 'busy' } }));
}

/**
 * CI has a real Claude key, so the server's background step may translate a message
 * before the test taps Translate. Hide that stored translation from this page (list,
 * polling and the live socket) so the tap always goes through the mocked endpoint.
 */
async function hideStoredTranslation(page: Page, messageId: string) {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]));
      if (o.id === messageId && 'translation' in o) o.translation = null;
      return o;
    }
    return v;
  };
  await page.route('**/api/live/ticket', (route) => route.fulfill({ status: 503, json: { error: 'off in this test' } }));
  await page.route('**/api/conversations/*/messages**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (body === null) return route.fulfill({ response: res });
    await route.fulfill({ response: res, json: strip(body) });
  });
}

const WORDS = [
  { text: '我们', pinyin: 'wǒmen', gloss: 'we' },
  { text: '明天', pinyin: 'míngtiān', gloss: 'tomorrow' },
  { text: '去', pinyin: 'qù', gloss: 'go' },
  { text: '商店', pinyin: 'shāngdiàn', gloss: 'shop' },
  { text: '吧', pinyin: 'ba', gloss: '(suggestion)' },
  { text: '！', pinyin: '', gloss: '' },
];

test('word chips from words, the word sheet, and the 拼 / EN toggles', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const m = await say(request, tutor, convId, '我们明天去商店吧！');
  const chatPath = `/connections/${relId}/chat/${convId}`;

  const asked: string[] = [];
  const page = await openAs(browser, student, chatPath, undefined, async (p) => {
    await p.route('**/api/messages/*/words', async (route) => {
      asked.push(route.request().url());
      await route.fulfill({ json: { words: WORDS, source: 'content', cached: false } });
    });
    await hideStoredTranslation(p, m.id);
    await p.route(`**/api/messages/${m.id}/translate`, (route) =>
      route.fulfill({ json: { translation: "Let's go to the shop tomorrow!" } }),
    );
  });

  const bubble = page.locator(`[data-msg-id="${m.id}"]`);
  await expect(bubble.getByTestId('chat-words')).toBeVisible({ timeout: 20000 });
  expect(asked.length).toBe(1);
  expect(asked[0]).toContain(m.id);

  // Tap a word → the reader's word sheet.
  await bubble.getByRole('button', { name: '商店' }).click();
  const sheet = page.getByRole('dialog', { name: 'The word 商店' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('shāngdiàn');
  await expect(sheet).toContainText('shop');
  await expect(sheet.getByRole('button', { name: '+ Add as card' })).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(sheet).toHaveCount(0);

  // Menu → Pinyin: pinyin over each word; Translate: the translation (fetched once).
  await bubble.getByRole('button', { name: 'More actions' }).click();
  await page.locator('[data-tool="pinyin"]').click();
  await expect(bubble.locator('rt').first()).toHaveText('wǒmen');
  await bubble.getByRole('button', { name: 'More actions' }).click();
  await page.locator('[data-tool="translate"]').click();
  await expect(bubble.getByTestId('chat-translation')).toHaveText("Let's go to the shop tomorrow!");

  // Remembered per conversation on the device.
  await page.reload();
  const again = page.locator(`[data-msg-id="${m.id}"]`);
  await expect(again.locator('rt').first()).toHaveText('wǒmen', { timeout: 20000 });
  await again.getByRole('button', { name: 'More actions' }).click();
  await expect(page.locator('[data-tool="pinyin"]')).toHaveText('拼Hide pinyin');

  await page.context().close();
});

test('Translate that fails says so inline, switches itself off, and works on the next tap', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const m = await say(request, tutor, convId, '明天我们上课的时候先复习一下上次学的生词，然后我会给你讲一个新的语法点。');
  let calls = 0;
  const page = await openAs(browser, student, `/connections/${relId}/chat/${convId}`, undefined, async (p) => {
    await noWords(p);
    await hideStoredTranslation(p, m.id);
    await p.route(`**/api/messages/${m.id}/translate`, (route) => {
      calls += 1;
      return calls === 1
        ? route.fulfill({ status: 503, json: { error: 'Translation is busy right now — try again in a moment.', retryable: true } })
        : route.fulfill({ json: { translation: 'In class tomorrow we will first review the new words.' } });
    });
  });

  const bubble = page.locator(`[data-msg-id="${m.id}"]`);
  await expect(bubble).toBeVisible({ timeout: 20000 });
  await bubble.getByRole('button', { name: 'More actions' }).click();
  await page.locator('[data-tool="translate"]').click();
  await expect(page.getByRole('alert')).toContainText("Couldn't translate that message. Translation is busy right now");
  await expect(bubble.getByTestId('chat-translation')).toHaveCount(0);

  await bubble.getByRole('button', { name: 'More actions' }).click();
  await expect(page.locator('[data-tool="translate"]')).toContainText('Translate');
  await page.locator('[data-tool="translate"]').click();
  await expect(bubble.getByTestId('chat-translation')).toHaveText('In class tomorrow we will first review the new words.');
  expect(calls).toBe(2);

  await page.context().close();
});

test('make flashcards: pick messages → review → one batch add', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: '聊天生词' } });
  // A newer deck, but 聊天生词 is moved to the top of the study queue: the sheet starts on it.
  await api(request, '/api/decks', { method: 'POST', token: student.token, data: { name: 'Weekend words' } });
  await api(request, `/api/decks/${deck.body.id}/move`, { method: 'POST', token: student.token, data: { to: 'top' } });
  const m1 = await say(request, tutor, convId, '你周末打算做什么？');
  await say(request, student, convId, '我想去爬山。');
  const chatPath = `/connections/${relId}/chat/${convId}`;

  let proposeBody: unknown = null;
  let batch = null as { url: string; body: unknown } | null;
  const page = await openAs(browser, student, chatPath, undefined, (p) => noWords(p));
  await page.route(`**/api/conversations/${convId}/flashcards/propose`, async (route) => {
    proposeBody = route.request().postDataJSON();
    await route.fulfill({
      json: {
        cards: [
          {
            hanzi: '打算',
            pinyin: 'dǎsuàn',
            english: 'to plan',
            fun_facts: '打 (dǎ) do + 算 (suàn) reckon',
            sentence_clue: '你周末打算做什么？',
            sentence_clue_pinyin: 'Nǐ zhōumò dǎsuàn zuò shénme?',
            sentence_clue_translation: 'What do you plan to do at the weekend?',
            already_have: false,
            source_message_id: m1.id,
          },
          { hanzi: '周末', pinyin: 'zhōumò', english: 'weekend', fun_facts: '周 week + 末 end', already_have: true, source_message_id: m1.id },
        ],
      },
    });
  });
  await page.route('**/api/decks/*/notes/batch', async (route) => {
    batch = { url: route.request().url(), body: route.request().postDataJSON() };
    await route.fulfill({ status: 201, json: { created: [{ id: 'n1', hanzi: '打算' }], failed: [] } });
  });

  await expect(page.getByText('你周末打算做什么？')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: /Make flashcards/ }).click();
  await expect(page.getByTestId('chat-select-bar')).toBeVisible();
  await page.getByTestId('chat-message').filter({ hasText: '你周末打算做什么？' }).click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Make flashcards' }).click();

  const review = page.getByRole('dialog', { name: 'Make flashcards' });
  await expect(review.getByTestId('chat-card-item')).toHaveCount(2, { timeout: 10000 });
  expect(proposeBody).toEqual({ message_ids: [m1.id] });
  // The word already in a deck starts unticked and says so.
  await expect(review.getByRole('checkbox', { name: 'Add 打算' })).toBeChecked();
  await expect(review.getByRole('checkbox', { name: 'Add 周末' })).not.toBeChecked();
  await expect(review.getByText('Already in your decks')).toBeVisible();
  await expect(review.getByText('From “你周末打算做什么？”').first()).toBeVisible();

  // The top deck of the queue is preselected and listed first.
  await expect(review.getByLabel('Deck')).toHaveValue(deck.body.id);
  await expect(review.getByLabel('Deck').locator('option').first()).toHaveText('聊天生词');

  // Edit one field, add.
  await review.getByRole('button', { name: 'Edit 打算' }).click();
  await review.getByRole('textbox', { name: 'English', exact: true }).fill('to plan (to)');
  await review.getByRole('button', { name: 'Done' }).click();
  await review.getByRole('button', { name: 'Add 1 card' }).click();

  await expect(review).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByText('Added 1 card to 聊天生词.')).toBeVisible();
  expect(batch).not.toBeNull();
  expect(batch!.url).toContain(`/api/decks/${deck.body.id}/notes/batch`);
  expect(batch!.body).toEqual({
    notes: [
      {
        hanzi: '打算',
        pinyin: 'dǎsuàn',
        english: 'to plan (to)',
        fun_facts: '打 (dǎ) do + 算 (suàn) reckon',
        sentence_clue: '你周末打算做什么？',
        sentence_clue_pinyin: 'Nǐ zhōumò dǎsuàn zuò shénme?',
        sentence_clue_translation: 'What do you plan to do at the weekend?',
      },
    ],
  });
  // Nothing is remembered: the next sheet starts on the top deck again.
  expect(await page.evaluate(() => localStorage.getItem('chat-flashcards-last-deck'))).toBeNull();

  await page.context().close();
});

test('the tutor corrects a message; the student sees the diff and can make a card from it', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  const m = await say(request, student, convId, '我昨天去去商店买东西');
  const chatPath = `/connections/${relId}/chat/${convId}`;

  const tutorPage = await openAs(browser, tutor, chatPath, { width: 1280, height: 860 }, noWords);
  const theirs = tutorPage.getByTestId('chat-message').filter({ hasText: '我昨天去去商店买东西' });
  await expect(theirs).toBeVisible({ timeout: 20000 });
  await theirs.getByRole('button', { name: 'More actions' }).click();
  await tutorPage.locator('[data-tool="correct"]').click();
  const sheet = tutorPage.getByRole('dialog', { name: 'Correct this message' });
  await sheet.getByLabel('Corrected').fill('我昨天去商店买了东西。');
  await sheet.getByLabel('Note (optional)').fill('了 goes right after the verb 买');
  await sheet.getByRole('button', { name: 'Save correction' }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10000 });
  const tutorBlock = theirs.getByTestId('chat-correction');
  await expect(tutorBlock).toBeVisible();
  await expect(tutorBlock.locator('ins')).toHaveText('了');
  await expect(tutorBlock.getByRole('button', { name: 'Edit' })).toBeVisible();

  // Stored on the server for the student.
  const msgs = await api<{ messages: Array<{ id: string; correction: { text: string; note: string } | null }> }>(
    request,
    `/api/conversations/${convId}/messages`,
    { token: student.token },
  );
  expect(msgs.body.messages.find((x) => x.id === m.id)?.correction).toMatchObject({ text: '我昨天去商店买了东西。', note: '了 goes right after the verb 买' });

  // The student's side: the diff, the note, "+ Make a card from this" → propose with focus.
  const studentPage = await openAs(browser, student, chatPath, undefined, noWords);
  let proposeBody: unknown = null;
  await studentPage.route(`**/api/conversations/${convId}/flashcards/propose`, async (route) => {
    proposeBody = route.request().postDataJSON();
    await route.fulfill({
      json: { cards: [{ hanzi: '买了东西', pinyin: 'mǎile dōngxi', english: 'bought things', fun_facts: '买 buy + 了', already_have: false, source_message_id: m.id }] },
    });
  });
  const mine = studentPage.locator(`[data-msg-id="${m.id}"]`);
  const block = mine.getByTestId('chat-correction');
  await expect(block).toBeVisible({ timeout: 20000 });
  await expect(block).toContainText('王明慧');
  await expect(block.locator('ins')).toHaveText('了');
  await expect(block.locator('del')).toHaveText('去');
  await expect(block).toContainText('了 goes right after the verb 买');
  await block.getByRole('button', { name: '+ Make a card from this' }).click();
  await expect(studentPage.getByRole('dialog', { name: 'Make flashcards' }).getByTestId('chat-card-item')).toHaveCount(1, { timeout: 10000 });
  expect(proposeBody).toEqual({ message_ids: [m.id], focus: 'correction' });

  await studentPage.context().close();
  await tutorPage.context().close();
});

test('check my Chinese before sending → Use this replaces the draft', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { tutor, student, relId, convId } = await seedChat(request);
  await say(request, tutor, convId, '你昨天做了什么？');
  const chatPath = `/connections/${relId}/chat/${convId}`;
  const page = await openAs(browser, student, chatPath, undefined, noWords);
  let coached = '';
  await page.route('**/api/sentence/coach', async (route) => {
    coached = (route.request().postDataJSON() as { sentence: string }).sentence;
    await route.fulfill({
      json: {
        originalInput: coached,
        inputLanguage: 'chinese',
        isCorrect: false,
        corrected: { hanzi: '我昨天去商店买了东西。', pinyin: 'Wǒ zuótiān qù shāngdiàn mǎile dōngxi.', english: 'Yesterday I went to the shop and bought things.' },
        critique: '了 marks the completed action, so it follows 买.',
        issues: [],
        alternatives: [],
        vocabSuggestions: [],
      },
    });
  });
  await expect(page.getByText('你昨天做了什么？')).toBeVisible({ timeout: 20000 });

  const box = page.getByRole('textbox', { name: 'Message' });
  await expect(page.getByRole('button', { name: 'Check my Chinese' })).toHaveCount(0);
  await box.fill('我昨天去去商店买东西');
  await page.getByRole('button', { name: 'Check my Chinese' }).click();
  const panel = page.getByTestId('chat-check-panel');
  await expect(panel).toContainText('了 marks the completed action', { timeout: 10000 });
  expect(coached).toBe('我昨天去去商店买东西');
  await expect(panel.locator('ins')).toHaveText('了');
  await panel.getByRole('button', { name: 'Use this' }).click();
  await expect(box).toHaveValue('我昨天去商店买了东西。');
  await expect(panel).toHaveCount(0);

  // The tutor never gets the ✓ (it is the learner's tool).
  const tutorPage = await openAs(browser, tutor, chatPath, { width: 1280, height: 860 }, noWords);
  await expect(tutorPage.getByText('你昨天做了什么？')).toBeVisible({ timeout: 20000 });
  await tutorPage.getByRole('textbox', { name: 'Message' }).fill('很好！');
  await tutorPage.getByRole('textbox', { name: 'Message' }).fill('你说得很好');
  await expect(tutorPage.getByRole('button', { name: 'Check my Chinese' })).toHaveCount(0);

  await page.context().close();
  await tutorPage.context().close();
});
