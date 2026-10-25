import { test, expect, APIRequestContext, Page } from '@playwright/test';

/**
 * The reader queue — "Up next" on the Readers list (shared/reader/queue.ts):
 * unread stories newest first until reordered; #N → Move to top reorders on the
 * device at once and on the server; a read story is not in the queue.
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

const story = (zh: string, en: string) => ({
  title_chinese: zh,
  title_english: en,
  difficulty_level: 'beginner',
  pages: [{ content_chinese: `${zh}。`, content_pinyin: '', content_english: en }],
});

async function waitForReaders(page: Page, ids: string[]) {
  await expect.poll(() => page.evaluate((want) => new Promise<number>((resolve) => {
    const open = indexedDB.open('ChineseLearningDB');
    open.onerror = () => resolve(0);
    open.onsuccess = () => {
      try {
        const all = open.result.transaction('readers', 'readonly').objectStore('readers').getAll();
        all.onsuccess = () => { resolve((all.result as Array<{ id: string }>).filter(r => want.includes(r.id)).length); open.result.close(); };
        all.onerror = () => { resolve(0); open.result.close(); };
      } catch { resolve(0); open.result.close(); }
    };
  }), ids), { timeout: 45_000 }).toBe(ids.length);
}

test('Up next lists unread stories in queue order and Move to top reorders them', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `queue-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const { session_token: token } = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const ids: string[] = [];
  for (const [zh, en] of [['旧故事', 'Old story'], ['中间的故事', 'Middle story'], ['新故事', 'New story'], ['读过的故事', 'Read story']]) {
    const r = await api<{ id: string }>(request, '/api/readers/import', { method: 'POST', token, data: { spec: story(zh, en) } });
    ids.push(r.id);
    await new Promise(res => setTimeout(res, 1100)); // distinct created_at
  }
  await api(request, '/api/reader-reviews', { method: 'POST', token, data: { events: [{ id: `ev-${Date.now()}`, reader_id: ids[3], rating: 2, reviewed_at: new Date().toISOString() }] } });

  await page.goto(`/?session_token=${token}`);
  await waitForReaders(page, ids);
  await page.goto('/readers');
  const rows = page.getByTestId('reader-up-next-row');
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  // Never reordered: newest first; the read story is not in the queue.
  await expect(rows.nth(0)).toContainText('新故事');
  await expect(rows.nth(2)).toContainText('旧故事');

  await rows.nth(2).getByTestId('queue-position').click();
  await page.getByRole('menuitem', { name: '⤒ Move to top' }).click();
  await expect(rows.nth(0)).toContainText('旧故事');
  await expect(rows.nth(0)).toContainText('Next in your session');

  await expect.poll(async () => (await api<{ queue: Array<{ id: string }> }>(request, '/api/readers/queue', { token })).queue.map(r => r.id), { timeout: 15_000 })
    .toEqual([ids[0], ids[2], ids[1]]);
});
