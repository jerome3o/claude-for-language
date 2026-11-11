import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * Source decks (docs/STUDY_SESSION.md "Source decks"): a reader word → the language explorer →
 * "+ Add as card" saves in ONE tap — no deck picker — straight into "From readers" (made on first
 * use, found by its key), the explorer says "✓ Added to From readers · Change", and Change moves
 * the note to another deck. Hermetic: no model (the reader is imported with its words).
 *
 * SOURCE_DECK_SHOTS=<dir> also saves phone-size screenshots there (PR screenshots).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const SHOTS = process.env.SOURCE_DECK_SHOTS;

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
  const email = `source-decks-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;
  // An ordinary deck of his own to move the card into.
  const hsk = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token, data: { name: 'HSK 2' } });
  const r = await api<{ reader?: { id: string }; id?: string }>(request, '/api/readers/import', {
    method: 'POST',
    token,
    data: {
      spec: {
        title_chinese: '去咖啡馆',
        title_english: 'To the café',
        difficulty_level: 'beginner',
        pages: [{ content_chinese: '他喝了一杯咖啡。', content_pinyin: 'Tā hēle yì bēi kāfēi.', content_english: 'He drank a cup of coffee.' }],
      },
    },
  });
  return { token, hskId: hsk.id, readerId: r.reader?.id ?? r.id! };
}

async function openReader(page: Page, token: string, readerId: string) {
  await page.goto(`/?session_token=${token}`);
  await expect.poll(() => page.evaluate((id) => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('readers', 'readonly').objectStore('readers').get(id);
        get.onsuccess = () => { resolve(!!get.result); open.result.close(); };
        get.onerror = () => { resolve(false); open.result.close(); };
      } catch { resolve(false); open.result.close(); }
    };
  }), readerId), { timeout: 45_000 }).toBe(true);
  await page.goto(`/readers/${readerId}`);
  await expect(page.getByTestId('reader-view')).toBeVisible({ timeout: 30_000 });
}

test('a reader word: + Add as card lands in "From readers" in one tap, and Change moves it', async ({ page, request }) => {
  test.setTimeout(150_000);
  const { token, hskId, readerId } = await seed(request);
  await openReader(page, token, readerId);

  await page.locator('.reader-chinese-reveal-box').click();
  await page.locator('.reader-word-chip', { hasText: /^咖啡$/ }).click();
  const view = page.getByRole('dialog', { name: 'The word 咖啡' });
  await expect(view).toBeVisible({ timeout: 15_000 });
  const add = view.getByTestId('explorer-add-card');
  await expect(add).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-e2e-01-word.png` });

  // ONE tap: no add sheet, no deck list.
  await add.click();
  await expect(page.getByRole('radiogroup', { name: 'Deck' })).toHaveCount(0);
  const line = view.getByTestId('added-to-deck');
  await expect(line).toContainText('✓ Added to From readers', { timeout: 15_000 });
  await expect(view.getByTestId('added-to-deck-change')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-e2e-02-added.png` });

  // The server made "From readers" (by key) and the note is in it.
  const sourceDeck = async () => {
    const decks = await api<Array<{ id: string; name: string; source_key?: string | null }>>(request, '/api/decks', { token });
    return decks.find((d) => d.source_key === 'readers') ?? null;
  };
  await expect.poll(async () => (await sourceDeck())?.name ?? null, { timeout: 15_000 }).toBe('From readers');
  const src = (await sourceDeck())!;
  const inSource = await api<{ notes: Array<{ id: string; hanzi: string }> }>(request, `/api/decks/${src.id}`, { token });
  expect(inSource.notes.map((n) => n.hanzi)).toEqual(['咖啡']);

  // Change → the deck list → HSK 2: the note moves.
  await view.getByTestId('added-to-deck-change').click();
  const sheet = page.getByTestId('move-to-deck');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: 'From readers' })).toHaveAttribute('aria-checked', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-e2e-03-change.png` });
  await sheet.getByRole('radio', { name: 'HSK 2' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(line).toContainText('✓ Moved to HSK 2');
  await expect.poll(async () => {
    const d = await api<{ notes: Array<{ hanzi: string }> }>(request, `/api/decks/${hskId}`, { token });
    return d.notes.map((n) => n.hanzi);
  }, { timeout: 15_000 }).toEqual(['咖啡']);

  // Asked again, the source deck is the same one (found by its key).
  const again = await api<{ deck: { id: string; name: string }; created: boolean }>(request, '/api/decks/source', { method: 'POST', token, data: { key: 'readers' } });
  expect(again).toMatchObject({ created: false, deck: { id: src.id } });
});
