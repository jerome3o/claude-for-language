import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * The call's text board tab-complete: type Chinese, pause, and a grey
 * " - pīnyīn - meaning" appears after the caret; Tab types it in (the other
 * person sees it through the CRDT like any typing), Esc / typing on dismisses,
 * nothing while an IME composition is open, and the ⋯ setting turns it off.
 * On a touch screen a "⇥ …" chip accepts on tap.
 *
 * The gloss endpoint is mocked in the browser (no AI keys in CI).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
});

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string, role?: 'tutor' | 'student'): Promise<SeededUser> {
  const email = `gloss-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name, role } });
  return { id: r.user.id, email, token: r.session_token };
}

const GLOSSES: Record<string, { pinyin: string; english: string }> = {
  一杯咖啡: { pinyin: 'yì bēi kāfēi', english: 'a cup of coffee' },
  你好: { pinyin: 'nǐ hǎo', english: 'hello' },
  谢谢: { pinyin: 'xièxie', english: 'thank you' },
  再见: { pinyin: 'zàijiàn', english: 'goodbye' },
  我想喝茶: { pinyin: 'wǒ xiǎng hē chá', english: 'I want to drink tea' },
};

/** Mock POST /api/calls/:id/gloss in this page; returns the texts asked for. */
async function mockGloss(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/calls/*/gloss', async (route) => {
    const { text } = route.request().postDataJSON() as { text: string };
    asked.push(text);
    const g = GLOSSES[text];
    await route.fulfill(g ? { status: 200, contentType: 'application/json', body: JSON.stringify({ text, ...g }) } : { status: 503, contentType: 'application/json', body: '{"error":"none"}' });
  });
  return asked;
}

async function openAs(browser: Browser, token: string, opts: { viewport: { width: number; height: number }; hasTouch?: boolean; isMobile?: boolean }): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], ...opts });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function joinAndOpenBoard(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  const button = page.getByTestId('join-call');
  await expect(button).toBeEnabled({ timeout: 20000 });
  await button.click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
  // Round 5: the tutor opening the board shows it to the student — open it only if it isn't there yet.
  const tiles = page.getByTestId('call-tiles');
  await expect(tiles).toHaveAttribute('data-stage', /text/, { timeout: 2000 }).catch(() => page.getByTestId('open-board').click());
  await page.getByTestId('text-board').waitFor();
}

test('text board tab-complete: ghost after a pause, Tab accepts for both, Esc / typing / IME / setting', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const tutor = await seedUser(request, 'tutor', '王老师', 'tutor'); // a tutor account, like Minghui's
  const student = await seedUser(request, 'student', 'Student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  // The tutor on a desktop browser, the student on a phone.
  const tp = await openAs(browser, tutor.token, { viewport: { width: 1280, height: 800 } });
  const sp = await openAs(browser, student.token, { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const tAsked = await mockGloss(tp);
  const sAsked = await mockGloss(sp);
  await joinAndOpenBoard(tp, call.id);
  await joinAndOpenBoard(sp, call.id);

  const tBoard = tp.getByTestId('text-board');
  const sBoard = sp.getByTestId('text-board');
  const tGhost = tp.getByTestId('text-board-ghost');

  // ---- Type Chinese, pause: grey ghost after the caret; only the typist sees it.
  await tBoard.click();
  await tp.keyboard.type('一杯咖啡');
  await expect(tGhost).toHaveText(/ - yì bēi kāfēi - a cup of coffee/, { timeout: 5000 });
  await expect(tGhost.locator('kbd')).toHaveText('Tab');
  await expect(sBoard).toHaveValue('一杯咖啡', { timeout: 10000 });
  await expect(sp.getByTestId('text-board-ghost')).toHaveCount(0);

  // ---- Tab accepts: inserted like typing, the other person sees it.
  await tp.keyboard.press('Tab');
  await expect(tBoard).toHaveValue('一杯咖啡 - yì bēi kāfēi - a cup of coffee');
  await expect(tGhost).toHaveCount(0);
  await expect(tBoard).toBeFocused();
  await expect(sBoard).toHaveValue('一杯咖啡 - yì bēi kāfēi - a cup of coffee', { timeout: 10000 });

  // ---- Esc dismisses (and it stays away for that text).
  await tp.keyboard.press('Enter');
  await tp.keyboard.type('你好');
  await expect(tGhost).toBeVisible({ timeout: 5000 });
  await tp.keyboard.press('Escape');
  await expect(tGhost).toHaveCount(0);
  await tp.waitForTimeout(900);
  await expect(tGhost).toHaveCount(0);
  await expect(tBoard).toHaveValue('一杯咖啡 - yì bēi kāfēi - a cup of coffee\n你好');

  // ---- Typing on dismisses; a repeat comes from the cache (no second request).
  await tp.keyboard.press('Enter');
  await tp.keyboard.type('谢谢');
  await expect(tGhost).toHaveText(/xièxie - thank you/, { timeout: 5000 });
  await tp.keyboard.type('!');
  await expect(tGhost).toHaveCount(0);
  await tp.keyboard.press('Backspace');
  await expect(tGhost).toHaveText(/xièxie - thank you/, { timeout: 5000 });
  expect(tAsked.filter((t) => t === '谢谢')).toHaveLength(1);
  await tp.keyboard.press('Tab');
  await expect(sBoard).toHaveValue(/\n谢谢 - xièxie - thank you$/, { timeout: 10000 });

  // ---- Nothing while an IME composition is open (the pause starts at compositionend).
  await tp.keyboard.press('Enter');
  const cdp = await tp.context().newCDPSession(tp);
  await cdp.send('Input.imeSetComposition', { selectionStart: 1, selectionEnd: 1, text: 'z' });
  await cdp.send('Input.imeSetComposition', { selectionStart: 6, selectionEnd: 6, text: 'zaijian' });
  await tp.waitForTimeout(900);
  await expect(tGhost).toHaveCount(0);
  expect(tAsked).not.toContain('再见');
  await cdp.send('Input.insertText', { text: '再见' });
  await expect(tGhost).toHaveText(/zàijiàn - goodbye/, { timeout: 5000 });
  await tp.keyboard.press('Escape');

  // ---- Some macOS IMEs in Chrome send compositionend BEFORE the input event with the committed text
  // (still flagged isComposing). That used to leave the board "composing" for good: no suggestion ever
  // again (Minghui, 5 Oct 2026). Replayed here as DOM events in that order.
  await tp.keyboard.press('Enter');
  await tBoard.evaluate((ta: HTMLTextAreaElement) => {
    const fire = (e: Event) => ta.dispatchEvent(e);
    const set = (v: string) => {
      ta.value = v;
      ta.setSelectionRange(v.length, v.length);
    };
    const base = ta.value;
    fire(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    fire(new CompositionEvent('compositionupdate', { data: 'nihao', bubbles: true }));
    set(base + 'nihao');
    fire(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: 'nihao' }));
    fire(new CompositionEvent('compositionend', { data: '你好', bubbles: true }));
    set(base + '你好');
    fire(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '你好' }));
  });
  await expect(tGhost).toHaveText(/nǐ hǎo - hello/, { timeout: 5000 });
  await expect(sBoard).toHaveValue(/\n你好$/, { timeout: 10000 });
  await tp.keyboard.press('Escape');

  // ---- The ⋯ setting turns it off (remembered for this user).
  await tp.getByTestId('text-board-menu').click();
  await tp.getByTestId('text-board-gloss-toggle').uncheck();
  await tBoard.click();
  await tp.keyboard.press('Control+End');
  await tp.keyboard.press('Enter');
  await tp.keyboard.type('我想喝茶');
  await tp.waitForTimeout(900);
  await expect(tGhost).toHaveCount(0);
  expect(tAsked).not.toContain('我想喝茶');
  expect(await tp.evaluate((id) => localStorage.getItem(`call-board-gloss:${id}`), tutor.id)).toBe('off');

  // ---- Touch: the student gets a "⇥ …" chip under the caret; a tap accepts.
  await sBoard.tap();
  await sp.keyboard.press('Control+End');
  await sp.keyboard.press('Enter');
  await sp.keyboard.insertText('你好');
  const chip = sp.getByTestId('text-board-gloss-chip');
  await expect(chip).toHaveText('⇥ nǐ hǎo - hello', { timeout: 5000 });
  await expect(sp.getByTestId('text-board-ghost').locator('kbd')).toHaveCount(0);
  await chip.tap();
  await expect(sBoard).toHaveValue(/\n你好 - nǐ hǎo - hello$/);
  await expect(sBoard).toBeFocused();
  await expect(tBoard).toHaveValue(/\n你好 - nǐ hǎo - hello$/, { timeout: 10000 });
  expect(sAsked).toContain('你好');
});
