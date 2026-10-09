import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Unlockable mini lessons (docs/STUDY_SESSION.md "Unlockable lessons"): a lesson created with an
 * unlock condition waits in "Ready to unlock" (never in Up next / the session); "✓ Done — unlock"
 * puts it in today's lessons at once; it then plays in the session like any lesson.
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

const spec = {
  title: '打包 · Taking food home',
  icon: '🥡',
  sections: [{
    exercises: [{
      type: 'note',
      title: '打包',
      body: '打 dǎ — 3rd tone — to do / make\n包 bāo — 1st tone — to wrap',
      sentences: [{ hanzi: '服务员，这个帮我打包。', pinyin: 'Fúwùyuán, zhège bāng wǒ dǎbāo.', english: 'Waiter, please pack this up for me.' }],
    }],
  }],
};

test('a locked lesson waits in Ready to unlock; unlocking puts it in today; it plays', async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = `unlock-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;

  // A bad condition is refused; a real one is stored.
  const bad = await request.fetch(`${API}/api/custom-lessons`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    data: JSON.stringify({ spec, unlock: { kind: 'audio_lesson', audio_lesson_id: 'not-mine' } }),
  });
  expect(bad.status()).toBe(400);
  const created = await api<{ id: string; unlock: { kind: string; prompt: string }; unlocked_at: string | null }>(request, '/api/custom-lessons', {
    method: 'POST', token, data: { spec, unlock: { kind: 'manual', prompt: 'Go to a restaurant and order 打包' } },
  });
  expect(created.unlock).toEqual({ kind: 'manual', prompt: 'Go to a restaurant and order 打包' });
  expect(created.unlocked_at).toBeNull();
  const id = created.id;

  // Mini Lessons: in "Ready to unlock" with the prompt, not in Up next.
  await page.goto(`/lessons?session_token=${token}`);
  const ready = page.getByTestId('ready-to-unlock');
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await expect(ready).toContainText('Go to a restaurant and order 打包');
  await expect(page.getByTestId(`lesson-play-${id}`)).toHaveCount(0);

  // Opening it directly shows the lock, not the lesson.
  await page.goto(`/lessons/${id}/play?session_token=${token}`);
  await expect(page.getByTestId('lesson-locked-gate')).toBeVisible({ timeout: 30_000 });

  // Unlock from the list: it moves to Up next at once, and the server has it.
  await page.goto(`/lessons?session_token=${token}`);
  await page.getByTestId(`unlock-${id}`).click();
  await expect(page.getByTestId(`lesson-play-${id}`)).toHaveText('▶ Start', { timeout: 30_000 });
  await expect(page.getByTestId('ready-to-unlock')).toHaveCount(0);
  await expect.poll(async () => {
    const list = await api<{ lessons: Array<{ id: string; unlocked_at: string | null }> }>(request, '/api/custom-lessons?status=all', { token });
    return !!list.lessons.find(l => l.id === id)?.unlocked_at;
  }, { timeout: 30_000 }).toBe(true);

  // Today's session offers it; rating it records a completion.
  await page.goto(`/study?autostart=true&session_token=${token}`);
  await expect(page.getByText('打包 · Taking food home').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /next|continue|got it/i }).first().click();
  await page.locator('.study-rating-sticky').getByRole('button', { name: /Good/ }).click();
  await expect.poll(async () => {
    const list = await api<{ lessons: Array<{ id: string; completions?: unknown[] }> }>(request, '/api/custom-lessons?status=all', { token });
    return list.lessons.find(l => l.id === id)?.completions?.length ?? 0;
  }, { timeout: 30_000 }).toBe(1);
});

test('a podcast companion: made from the player, waiting, unlocked by listening to the end, then Start', async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `companion-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const auth = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name: 'Jerome' } });
  const token = auth.session_token;

  await page.goto(`/audio-lessons?session_token=${token}`);
  await page.getByLabel('What situation do you want to practise?').fill("Dinner at a friend's parents' home");
  await page.getByRole('button', { name: '🎧 Make the lesson' }).click();
  const row = page.getByRole('button', { name: /^Play / }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.getByText('✓ Saved on this phone · plays offline')).toBeVisible({ timeout: 30_000 });

  // ✨ Make its mini lesson (E2E: a fake writer) → created LOCKED to this podcast.
  await page.getByTestId('al-companion-make').click();
  await expect(page.getByTestId('al-companion')).toContainText('🔒 Mini lesson waiting', { timeout: 60_000 });
  const audioId = new URL(page.url()).pathname.split('/').pop()!;
  const lessons = await api<{ lessons: Array<{ id: string; title: string; unlock: { kind: string; audio_lesson_id: string } | null; unlocked_at: string | null }> }>(request, '/api/custom-lessons?status=all', { token });
  const companion = lessons.lessons.find(l => l.unlock?.audio_lesson_id === audioId)!;
  expect(companion.title).toMatch(/ — mini lesson$/);
  expect(companion.unlocked_at).toBeNull();

  // Listen into the last chapter (Final listen): it unlocks by itself, and the card says it's ready.
  await page.getByRole('button', { name: '☰ Chapters' }).click();
  await page.locator('.al-chapters').getByText('Final listen', { exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('al-companion-ready')).toContainText('Mini lesson ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => {
    const list = await api<{ lessons: Array<{ id: string; unlocked_at: string | null }> }>(request, '/api/custom-lessons?status=all', { token });
    return !!list.lessons.find(l => l.id === companion.id)?.unlocked_at;
  }, { timeout: 30_000 }).toBe(true);

  // Start opens the lesson in the real player.
  await page.getByTestId('al-companion-start').click();
  await expect(page).toHaveURL(new RegExp(`/lessons/${companion.id}/play`));
  await expect(page.getByTestId('lesson-locked-gate')).toHaveCount(0);
  await expect(page.locator('.study-fullscreen, .study-topbar').first()).toBeVisible({ timeout: 30_000 });
});
