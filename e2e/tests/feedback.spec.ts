import { test, expect } from './fixtures/auth';

/**
 * In-app feedback (docs/FEEDBACK.md): More → 💬 Send feedback opens the sheet with a screenshot of the
 * page; a typed message is sent to POST /api/feedback and shows up in Settings → Feature requests as a
 * 🐛 Bug with its context line. Shift + ? opens the same sheet.
 */
test('send feedback with a screenshot from More, see it in Settings', async ({ authenticatedPage: page }) => {
  test.setTimeout(90_000);
  await page.gotoAuthenticated('/more');
  await page.locator('.nav-row', { hasText: 'Send feedback' }).click();
  const sheet = page.getByTestId('feedback-sheet');
  await expect(sheet).toBeVisible({ timeout: 20000 });
  await expect(sheet.getByRole('img', { name: 'Screenshot of the page' })).toBeVisible();

  await page.getByTestId('feedback-kind-bug').click();
  await page.getByTestId('feedback-input-type').click();
  await page.getByTestId('feedback-input-text').fill('The More page scrolls back to the top after a sync.');
  const posted = page.waitForResponse((r) => r.url().includes('/api/feedback') && r.request().method() === 'POST');
  await page.getByTestId('feedback-input-submit').click();
  expect((await posted).status()).toBe(201);
  await expect(page.getByTestId('feedback-done')).toContainText('Thanks — sent.');
  await expect(sheet).toBeHidden({ timeout: 5000 });

  // Shift + ? opens the sheet anywhere but a text box; Escape closes it.
  await page.keyboard.press('Shift+?');
  await expect(sheet).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.gotoAuthenticated('/settings');
  await page.getByText('Advanced', { exact: true }).click();
  const card = page.locator('.feature-request-card').filter({ hasText: 'scrolls back to the top' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card.getByText('🐛 Bug')).toBeVisible();
  await expect(card.getByText(/from Web .*\/more/)).toBeVisible();
  await expect(card.locator('img.feedback-thumb')).toBeVisible({ timeout: 20000 });
});
