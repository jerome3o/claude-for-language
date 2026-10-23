import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * "Judge each sentence" and "Choose the word for the gap" (shared/lesson/judgeGap.ts): every
 * sentence is answered, Check marks each one (icon + words), a wrong judgement makes the exercise
 * owed in the retry round, and the attempt keeps what was chosen per sentence for the tutor.
 * Offline checking — no AI, no TTS needed.
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
  const email = `judgegap-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Judge ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

const spec = {
  title: '了 and 刚 / 刚才',
  icon: '⚖️',
  sections: [{
    exercises: [
      {
        type: 'judge',
        question: 'Is 了 in the right place?',
        sentences: [
          { hanzi: '我昨天买了一本书。', pinyin: 'Wǒ zuótiān mǎi le yì běn shū.', english: 'I bought a book yesterday.', correct: true },
          { hanzi: '他了去北京。', correct: false, correction: { hanzi: '他去北京了。', pinyin: 'Tā qù Běijīng le.' }, explanation: '了 goes after the verb or at the end.' },
          { hanzi: '我已经吃饭了。', correct: true },
        ],
      },
      {
        type: 'gap_choice',
        question: '刚 or 刚才?',
        options: ['刚', '刚才'],
        items: [
          { sentence: '我___没听见。', answer: '刚才', pinyin: 'Wǒ gāngcái méi tīngjiàn.', explanation: '刚 can’t be followed by 没.' },
          { sentence: '他___来北京两个月。', answer: '刚' },
        ],
      },
    ],
  }],
};

test('judge every sentence, choose the word for each gap; a miss comes back; the tutor sees each choice', async ({ page, request }) => {
  const tutor = await seedUser(request, 'tutor');
  const student = await seedUser(request, 'student');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const item = await api<{ id: string }>(request, '/api/lesson-library', { method: 'POST', token: tutor.token, data: { spec } });
  await api(request, `/api/lesson-library/${item.id}/assign`, { method: 'POST', token: tutor.token, data: { relationship_ids: [relId] } });

  await page.goto(`/lessons?session_token=${student.token}`);
  await expect(page.getByText('了 and 刚 / 刚才').first()).toBeVisible({ timeout: 30000 });
  await page.locator('[data-testid^="lesson-play-"]').first().click();

  // ---- Judge: Check waits for every sentence
  const check = page.getByTestId('jg-check');
  await expect(check).toBeVisible({ timeout: 30000 });
  await expect(check).toBeDisabled();
  await expect(check).toHaveText('Check · 3 to go');
  const row = (i: number) => page.getByTestId(`judge-row-${i}`);
  await row(0).getByRole('button', { name: '✓ Correct' }).click();
  await row(1).getByRole('button', { name: '✓ Correct' }).click(); // wrong: it has a mistake
  await row(2).getByRole('button', { name: '✓ Correct' }).click();
  await expect(row(1).getByRole('button', { name: '✓ Correct' })).toHaveAttribute('aria-pressed', 'true');
  await check.click();
  await expect(row(1)).toContainText('✗ Not quite — this sentence has a mistake');
  await expect(row(1)).toContainText('他去北京了。');
  await expect(row(0)).toContainText('✓ Right — this sentence is correct');
  await expect(page.getByText('2 of 3 right')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Choose the word: the gap is never shown as "___"
  const gapRow = (i: number) => page.getByTestId(`gap-row-${i}`);
  await expect(gapRow(0)).toBeVisible();
  await expect(gapRow(0)).not.toContainText('___');
  await gapRow(0).getByRole('button', { name: '刚才', exact: true }).click();
  await gapRow(1).getByRole('button', { name: '刚', exact: true }).click();
  await page.getByTestId('jg-check').click();
  await expect(gapRow(0)).toContainText('✓ 刚才');
  await expect(gapRow(0)).toContainText('Wǒ gāngcái méi tīngjiàn.');
  await expect(page.getByText('✓ All 2 right')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- The retry round: the judge exercise missed first time comes back until it is right
  await expect(page.getByTestId('lesson-retry-line')).toBeVisible();
  await row(0).getByRole('button', { name: '✓ Correct' }).click();
  await row(1).getByRole('button', { name: '✗ Incorrect' }).click();
  await row(2).getByRole('button', { name: '✓ Correct' }).click();
  await page.getByTestId('jg-check').click();
  await expect(page.getByText('✓ All 3 right')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Lesson complete')).toBeVisible();
  await page.getByTestId('lesson-done').click();

  // ---- The attempt: one point per sentence, what was chosen per sentence
  await expect.poll(async () => {
    const r = await api<{ attempts: Array<{ id: string }> }>(request, `/api/relationships/${relId}/lesson-attempts`, { token: tutor.token });
    return r.attempts.length;
  }, { timeout: 30000 }).toBe(1);
  const list = await api<{ attempts: Array<{ id: string; correct: number; total: number }> }>(
    request, `/api/relationships/${relId}/lesson-attempts`, { token: tutor.token },
  );
  expect(list.attempts[0]).toMatchObject({ correct: 4, total: 5 });
  const detail = await api<{ attempt: { data: { exercises: Array<{ type: string; points: number; max_points: number; answer?: { items?: unknown[] } }> } } }>(
    request, `/api/relationships/${relId}/lesson-attempts/${list.attempts[0].id}`, { token: tutor.token },
  );
  const [judgeRow, gapRowData] = detail.attempt.data.exercises;
  expect(judgeRow).toMatchObject({ type: 'judge', points: 2, max_points: 3 });
  expect(judgeRow.answer?.items).toEqual([{ judged: true, correct: true }, { judged: true, correct: false }, { judged: true, correct: true }]);
  expect(gapRowData).toMatchObject({ type: 'gap_choice', points: 2, max_points: 2 });
  expect(gapRowData.answer?.items).toEqual([{ pick: '刚才', correct: true }, { pick: '刚', correct: true }]);

  // ---- Tutor review page
  await page.goto(`/connections/${relId}/lesson-attempts/${list.attempts[0].id}?session_token=${tutor.token}`);
  await expect(page.getByText('Lesson answers')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.att-card').first()).toContainText('Judge each sentence');
  await expect(page.locator('.att-card').first()).toContainText('said ✓ Correct');
  await expect(page.locator('.att-card').nth(1)).toContainText('我刚才没听见。');
});

test('the catalogue has both new types and their samples run as a trial', async ({ page, request }) => {
  const tutor = await seedUser(request, 'cat');
  await page.goto(`/library/catalogue?session_token=${tutor.token}`);
  await expect(page.getByRole('heading', { name: /Exercise catalogue/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /Judge each sentence/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Choose the word/ })).toBeVisible();
  await page.locator('#type-gap_choice').getByRole('link', { name: /Try it/ }).click();
  await expect(page.getByText('Preview · nothing is recorded')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('gap-row-0')).toBeVisible();
  for (const [i, w] of ['刚才', '刚', '刚才', '刚'].entries()) {
    await page.getByTestId(`gap-row-${i}`).getByRole('button', { name: w, exact: true }).click();
  }
  await page.getByTestId('jg-check').click();
  await expect(page.getByText('✓ All 4 right')).toBeVisible();
});
