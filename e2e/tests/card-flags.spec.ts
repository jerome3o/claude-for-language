import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Flag a card for the tutor, from the study screen, and the tutor's reply.
 *
 * Self-contained: seeds a tutor, a student and their pairing through the E2E
 * test-auth endpoint and the public API. No AI calls are involved.
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
  const email = `flags-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', {
    method: 'POST',
    data: { email, name: `Flags ${tag}` },
  });
  return { id: r.user.id, email, token: r.session_token };
}

test('student flags a card from study; tutor sees it, replies; student sees the reply', async ({ page, request }) => {
  const tutor = await seedUser(request, 'tutor');
  const student = await seedUser(request, 'student');
  const rel = await api<{ type: string; data: { id: string } }>(request, '/api/relationships', {
    method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' },
  });
  const relId = rel.data.id;
  await api(request, `/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });
  const deck = await api<{ id: string }>(request, '/api/decks', { method: 'POST', token: student.token, data: { name: '第三周作业' } });
  const note = await api<{ id: string }>(request, `/api/decks/${deck.id}/notes`, {
    method: 'POST', token: student.token, data: { hanzi: '银行', pinyin: 'yínháng', english: 'bank' },
  });

  // ---- Student: study the deck, flip the first card, ⋯ → Flag for tutor
  await page.goto(`/decks?session_token=${student.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  // Study is offline-first: wait until the sync has brought the new deck down.
  await expect(page.getByText('第三周作业')).toBeVisible({ timeout: 30000 });
  await page.goto(`/study?deck=${deck.id}&autostart=true`);
  // Reveal the back whichever card type came up first.
  const reveal = page.getByRole('button', { name: /Skip recording|Show Answer|Check Answer|Reveal/i }).first();
  await reveal.waitFor({ timeout: 30000 });
  // A brand-new account gets the first-card explainer over the card.
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  const typed = page.locator('input[type="text"], textarea').first();
  if (await typed.isVisible().catch(() => false)) await typed.fill('银行');
  await reveal.click();
  await page.getByTestId('study-action-row').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Flag for tutor/ }).click();
  const sheet = page.getByTestId('flag-card-sheet');
  await expect(sheet).toContainText('银行');
  await page.getByTestId('flag-card-input').fill('Is 行 here háng or xíng? I keep mixing it up with 很行');
  await page.getByTestId('flag-card-send').click();
  await expect(page.getByTestId('flag-card-done')).toContainText('Sent to Flags tutor');

  // Server: the flag exists and landed in the chat
  const listed = await api<{ flags: Array<{ id: string; note_id: string; status: string; message: string }>; open: number }>(
    request, `/api/relationships/${relId}/card-flags`, { token: tutor.token },
  );
  expect(listed.open).toBe(1);
  expect(listed.flags[0]).toMatchObject({ note_id: note.id, status: 'open' });
  expect(listed.flags[0].message).toContain('háng or xíng');

  // ---- Tutor: the student page shows the flag; reply inline
  await page.goto(`/connections/${relId}?session_token=${tutor.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  const section = page.getByTestId('flagged-cards-section');
  await expect(section).toContainText('银行');
  await expect(section).toContainText('háng or xíng');
  await section.getByTestId('card-flag-reply').click();
  await section.getByTestId('card-flag-reply-input').fill('银行 is háng: a place of business. 很行 is xíng.');
  await section.getByTestId('card-flag-reply-send').click();
  // A replied flag is resolved and folds away under "Show n resolved"
  await section.getByRole('button', { name: /Show 1 resolved/ }).click();
  await expect(section).toContainText('Replied');
  await expect(section).toContainText('a place of business');

  // The card hub page links from the flag and shows everything about the card
  await section.getByRole('link', { name: /银行/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/connections/${relId}/cards/${note.id}`));
  await expect(page.getByTestId('card-hub')).toContainText('银行');
  await expect(page.getByTestId('card-flags-list')).toContainText('a place of business');

  // ---- Student: the reply is waiting for the next time the card comes up
  const notes = await api<{ notes: Array<{ kind?: string; note_id: string; comment: string }> }>(request, '/api/me/recording-notes', { token: student.token });
  expect(notes.notes).toEqual([expect.objectContaining({ kind: 'flag', note_id: note.id, comment: expect.stringContaining('place of business') })]);

  // …and on their tutor page under "Cards you flagged"
  await page.goto(`/connections/${relId}?session_token=${student.token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  const mine = page.getByTestId('flagged-cards-section');
  await expect(mine).toContainText('Cards you flagged');
  await mine.getByRole('button', { name: /Show 1 resolved/ }).click();
  await expect(mine).toContainText('Flags tutor replied');
});
