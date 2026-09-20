import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Paste a list" on the deck page: add + update many words from pasted text,
 * then push the changes into a student's copy.
 *
 * Self-contained: seeds a tutor, a student, their pairing and a shared deck
 * through the E2E test-auth endpoint and the public API. The Claude gloss
 * endpoint is mocked in the browser so the test needs no API key.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

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

async function seedUser(request: APIRequestContext, tag: string): Promise<SeededUser> {
  const email = `paste-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Paste ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

test('paste a list: preview, fill with Claude, save, update the student copy', async ({ page, request }) => {
  const tutor = await seedUser(request, 'tutor');
  const student = await seedUser(request, 'student');
  const rel = await api<{ type: string; data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: tutor.token, data: { name: '水果 Fruit' } });
  await api(request, `/api/decks/${deck.id}/notes`, { method: 'POST', token: tutor.token, data: { hanzi: '香蕉', pinyin: 'xiāng jiāo', english: 'banana' } });
  await api(request, `/api/relationships/${rel.data.id}/share-deck`, { method: 'POST', token: tutor.token, data: { deck_id: deck.id } });

  // Claude is not available in the test container: answer the gloss call ourselves.
  await page.route('**/api/ai/gloss-words', async route => {
    const body = route.request().postDataJSON() as { words: Array<{ hanzi: string; pinyin?: string; english?: string }> };
    const gloss: Record<string, [string, string]> = { 葡萄: ['pú tao', 'grape'], 苹果: ['píng guǒ', 'apple'] };
    await route.fulfill({
      json: { words: body.words.map(w => ({ hanzi: w.hanzi, pinyin: w.pinyin || gloss[w.hanzi]?.[0] || '', english: w.english || gloss[w.hanzi]?.[1] || '' })) },
    });
  });

  await page.goto(`/decks/${deck.id}?session_token=${tutor.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Paste list/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Paste a word list' })).toBeVisible();

  await dialog.getByLabel('Word list').fill('苹果\tpíng guǒ\tapple\n香蕉\txiāng jiāo\tbanana (fruit)\n葡萄\nhello\tworld');
  await expect(dialog.getByText(/Reading it as: tab between columns · 4 rows/)).toBeVisible();
  await expect(dialog.getByText('New', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Update', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Needs english')).toBeVisible();
  await expect(dialog.getByText('No Chinese')).toBeVisible();
  // The update row shows the change
  await expect(dialog.locator('.pw-change', { hasText: 'banana (fruit)' })).toBeVisible();
  // Pinyin for the bare word was filled in on the device
  await expect(dialog.getByText(/✨ pú táo/)).toBeVisible();

  await dialog.getByRole('button', { name: /Fill in English with Claude/ }).click();
  await expect(dialog.getByText(/✨ grape/)).toBeVisible();
  await expect(dialog.getByText('New', { exact: true })).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Add 2 · Update 1' }).click();
  await expect(dialog.getByRole('heading', { name: 'Words saved' })).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByText('Added 2, updated 1')).toBeVisible();

  // The student's copy is listed and can be brought up to date
  const share = dialog.locator('.pw-share', { hasText: 'Paste student' });
  await expect(share).toContainText('2 new · 1 changed');
  await share.getByRole('button', { name: 'Update their copy' }).click();
  await expect(share).toContainText('added 2, updated 1');
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Server state: the tutor's deck and the student's copy
  const tutorDeck = await api<{ notes: Array<{ hanzi: string; english: string; pinyin: string }> }>(request, `/api/decks/${deck.id}`, { token: tutor.token });
  const byHanzi = Object.fromEntries(tutorDeck.notes.map(n => [n.hanzi, n]));
  expect(Object.keys(byHanzi).sort()).toEqual(['苹果', '葡萄', '香蕉']);
  expect(byHanzi['香蕉'].english).toBe('banana (fruit)');
  expect(byHanzi['葡萄']).toMatchObject({ pinyin: 'pú tao', english: 'grape' });
  const studentDecks = await api<Array<{ id: string; name: string }>>(request, '/api/decks', { token: student.token });
  const copy = studentDecks.find(d => d.name.includes('水果'));
  expect(copy).toBeTruthy();
  const copyDeck = await api<{ notes: Array<{ hanzi: string; english: string }> }>(request, `/api/decks/${copy!.id}`, { token: student.token });
  expect(copyDeck.notes.map(n => n.hanzi).sort()).toEqual(['苹果', '葡萄', '香蕉']);
  expect(copyDeck.notes.find(n => n.hanzi === '香蕉')?.english).toBe('banana (fruit)');
});

test('a WeChat-style space separated list and hanzi-only lines parse', async ({ page, request }) => {
  const user = await seedUser(request, 'solo');
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: user.token, data: { name: 'Lesson 3' } });
  await page.goto(`/decks/${deck.id}?session_token=${user.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Paste a list/ }).click();
  const dialog = page.getByRole('dialog');
  // A custom separator typed into the box takes over from auto-detection
  await dialog.getByLabel('Word list').fill('咖啡 -- coffee\n火车 -- train');
  await dialog.getByLabel('Custom separator').fill('--');
  await expect(dialog.getByText(/Reading it as: your separator · 2 rows/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^咖啡/ })).toContainText('coffee');
  await dialog.getByLabel('Custom separator').fill('');
  await dialog.getByLabel('Word list').fill('1. 咖啡 kāfēi coffee\n2. 火车 huǒ chē train\n3. 朋友');
  await expect(dialog.getByText(/Reading it as: spaces between word, pinyin and meaning · 3 rows/)).toBeVisible();
  await expect(dialog.getByText('New', { exact: true })).toHaveCount(2);
  await expect(dialog.getByText('Needs english')).toBeVisible();
  // Type the missing English inline and save
  await dialog.getByRole('button', { name: /朋友/ }).click();
  await dialog.getByLabel('English').fill('friend');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await dialog.getByRole('button', { name: 'Add 3' }).click();
  await expect(dialog.getByText('Added 3')).toBeVisible({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  const got = await api<{ notes: Array<{ hanzi: string; pinyin: string; english: string }> }>(request, `/api/decks/${deck.id}`, { token: user.token });
  expect(got.notes.map(n => [n.hanzi, n.pinyin, n.english]).sort()).toEqual([
    ['咖啡', 'kāfēi', 'coffee'],
    ['朋友', 'péng yǒu', 'friend'],
    ['火车', 'huǒ chē', 'train'],
  ]);
});
