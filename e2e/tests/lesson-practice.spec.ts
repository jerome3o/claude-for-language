import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Practice exercise types in a mini lesson, the per-exercise attempt the
 * tutor reviews, and the tutor's exercise catalogue (a trial records nothing).
 *
 * Self-contained: seeds a tutor, a student and their pairing through the E2E
 * test-auth endpoint; the tutor assigns a library lesson. No AI calls: TTS
 * is not configured in CI, and none of the steps below needs it.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {},
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
  const email = `practice-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Practice ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

const spec = {
  title: '练习 Practice types',
  icon: '🛠',
  sections: [
    {
      title: 'Writing',
      exercises: [
        { type: 'write_typed', answer: { hanzi: '图书馆', pinyin: 'túshūguǎn', english: 'library' } },
        { type: 'dictation', input: 'type', audio: { hanzi: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.', english: 'I like drinking tea.' } },
      ],
    },
  ],
};

test('student writes typed answers in a lesson; the tutor reviews the attempt', async ({ page, request }) => {
  const tutor = await seedUser(request, 'tutor');
  const student = await seedUser(request, 'student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const item = await api<{ id: string }>(request, '/api/lesson-library', { method: 'POST', token: tutor.token, data: { spec } });
  await api(request, `/api/lesson-library/${item.id}/assign`, { method: 'POST', token: tutor.token, data: { relationship_ids: [relId] } });

  // ---- Student: the lesson comes up in study (no cards → lessons first)
  await page.goto(`/lessons?session_token=${student.token}`);
  await expect(page.getByText('练习 Practice types').first()).toBeVisible({ timeout: 30000 });
  await page.goto('/study?autostart=true');

  // Typed writing: one wrong character is marked, not just "wrong"
  const input = page.locator('input.write-input');
  await input.waitFor({ timeout: 30000 });
  await input.fill('图书官');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('.char-diff .extra')).toHaveText('官');
  await expect(page.locator('.char-diff .miss')).toHaveText('馆');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Dictation (typed): punctuation doesn't count
  await page.locator('input.write-input').fill('我喜欢喝茶');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('✓ Every character right')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Lesson complete')).toBeVisible();
  await page.getByRole('button', { name: /Good/ }).first().click();

  // ---- The attempt reaches the server with what was typed
  await expect.poll(async () => {
    const r = await api<{ attempts: Array<{ id: string }> }>(request, `/api/relationships/${relId}/lesson-attempts`, { token: tutor.token });
    return r.attempts.length;
  }, { timeout: 30000 }).toBe(1);
  const list = await api<{ attempts: Array<{ id: string; correct: number; total: number }> }>(
    request, `/api/relationships/${relId}/lesson-attempts`, { token: tutor.token },
  );
  expect(list.attempts[0]).toMatchObject({ correct: 1, total: 2 });
  const detail = await api<{ attempt: { data: { exercises: Array<{ type: string; answer?: { text?: string } }> } } }>(
    request, `/api/relationships/${relId}/lesson-attempts/${list.attempts[0].id}`, { token: tutor.token },
  );
  expect(detail.attempt.data.exercises.map(e => [e.type, e.answer?.text])).toEqual([
    ['write_typed', '图书官'],
    ['dictation', '我喜欢喝茶'],
  ]);

  // ---- Tutor: the review page shows the answer with the wrong character
  await page.goto(`/connections/${relId}/lesson-attempts/${list.attempts[0].id}?session_token=${tutor.token}`);
  await expect(page.getByText('Lesson answers')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.att-card').first()).toContainText('Writing — typed');
  await expect(page.locator('.att-chars .extra').first()).toHaveText('官');
});

test('tutor catalogue lists every type; a sample lesson runs as a trial', async ({ page, request }) => {
  const tutor = await seedUser(request, 'cat');
  await page.goto(`/library/catalogue?session_token=${tutor.token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  for (const name of ['Conversation', 'Dictation', 'Oral expression', 'Sentence making', 'Writing — typed', 'Writing — handwriting']) {
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  }
  await page.locator('#type-write_typed').getByRole('link', { name: /Try it/ }).click();
  await expect(page.getByText('Trial — nothing is recorded')).toBeVisible({ timeout: 15000 });
  await page.locator('input.write-input').fill('图书馆');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('✓ Correct')).toBeVisible();
});
