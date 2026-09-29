import { test, expect } from './fixtures/auth';

/**
 * Picture hunt (/picture-hunt): a seeded hunt (no Gemini / Claude in CI) is
 * listed with its state, played by typing names (a find lights up, a near
 * miss nudges, a hint shows the first character), given up to reveal every
 * object, and the play is recorded (best score on the server).
 */

const API = 'http://localhost:8787/api';
// 1×1 PNG — the picture itself doesn't matter to the game logic.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const OBJECTS = [
  { id: 'o1', hanzi: '茶杯', pinyin: 'chábēi', english: 'teacup', alternatives: ['杯子'], sentence_clue: '桌子上有一个茶杯。', regions: [{ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, polygon: [[0.1, 0.1], [0.3, 0.1], [0.2, 0.3]] }] },
  { id: 'o2', hanzi: '桌子', pinyin: 'zhuōzi', english: 'table', alternatives: [], regions: [{ box: { x: 0.05, y: 0.5, w: 0.9, h: 0.45 } }] },
  { id: 'o3', hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', alternatives: [], regions: [{ box: { x: 0.6, y: 0.2, w: 0.15, h: 0.15 } }] },
];

test('play a picture hunt: find, near miss, hint, give up, reveal, play recorded', async ({ authenticatedPage: page, testUser, request }) => {
  const seed = async (data: Record<string, unknown>) => {
    const res = await request.post(`${API}/test/picture-hunt`, { data: { user_id: testUser.id, ...data } });
    expect(res.ok()).toBe(true);
    return (await res.json()).id as string;
  };
  const id = await seed({ title: '厨房 · Kitchen', objects: OBJECTS, image_base64: PNG, width: 800, height: 600 });
  await seed({ title: 'a street market', status: 'generating', progress: 'finding the objects' });
  await seed({ title: 'a classroom', status: 'error', error: 'Finding the objects failed (Gemini 503)' });

  await page.gotoAuthenticated('/picture-hunt');
  await expect(page.getByText('厨房 · Kitchen')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('3 objects · not played yet')).toBeVisible();
  await expect(page.getByText('Building… finding the objects')).toBeVisible();
  await expect(page.getByText('Finding the objects failed (Gemini 503)')).toBeVisible();
  await expect(page.getByRole('button', { name: '🔄 Retry' })).toBeVisible();

  await page.getByRole('button', { name: 'Play 厨房 · Kitchen' }).click();
  await expect(page).toHaveURL(new RegExp(`/picture-hunt/${id}$`));
  const input = page.getByLabel('What do you see?');
  await expect(input).toBeVisible();
  await expect(page.getByLabel('Score')).toHaveText('0 / 3');

  // An alternative is a find (checked as it is typed, no Enter needed).
  await input.fill('杯子');
  await expect(page.getByLabel('Score')).toHaveText('1 / 3');
  await expect(page.getByRole('status').first()).toContainText('✓ 茶杯 (also 杯子)');
  await expect(input).toHaveValue('');

  // A shared character is a nudge, not a find.
  await input.fill('苹');
  await input.press('Enter');
  await expect(page.getByText('So close — something here has 苹 in its name')).toBeVisible();
  await expect(page.getByLabel('Score')).toHaveText('1 / 3');

  await input.fill('狗');
  await input.press('Enter');
  await expect(page.getByText('Not one of the things I found — try another')).toBeVisible();

  // Hint: the biggest thing not found yet — the table.
  await page.getByRole('button', { name: '💡 Hint' }).click();
  await expect(page.getByText('💡 桌＿')).toBeVisible();

  await page.getByRole('button', { name: '🏳 Give up' }).click();
  await expect(page.getByText('1 / 3 found')).toBeVisible();
  await expect(page.getByText('🏆 New best!')).toBeVisible();

  // Every object is listed now; open a missed one.
  await page.getByRole('button', { name: /苹果/ }).click();
  const sheet = page.getByRole('dialog', { name: '苹果' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('píngguǒ');
  await expect(sheet).toContainText('Not found this time');
  await expect(sheet.getByRole('button', { name: '+ Add as card' })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Close' }).click();

  // The play reached the server (idempotent upload by play id).
  await expect.poll(async () => {
    const res = await request.get(`${API}/picture-hunts/${id}`, { headers: { Authorization: `Bearer ${testUser.sessionToken}` } });
    const { hunt } = await res.json();
    return [hunt.best_found, hunt.play_count];
  }, { timeout: 15000 }).toEqual([1, 1]);
});

test('the picture hunt API is private to its owner', async ({ testUser, request }) => {
  const res = await request.post(`${API}/test/picture-hunt`, { data: { user_id: testUser.id, objects: OBJECTS, image_base64: PNG } });
  const { id } = await res.json();
  const other = await request.post(`${API}/test/auth`, { data: { email: `e2e-other-${Date.now()}@test.e2e`, name: 'Other' } });
  const { session_token: sessionToken } = await other.json();
  const got = await request.get(`${API}/picture-hunts/${id}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  expect(got.status()).toBe(404);
  const img = await request.get(`${API}/picture-hunts/${id}/image`, { headers: { Authorization: `Bearer ${sessionToken}` } });
  expect(img.status()).toBe(404);
});
