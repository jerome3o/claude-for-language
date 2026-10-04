import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * /admin/audio — the TTS provider settings (docs/AUDIO.md "Providers").
 *
 * The admin adds Azure to the stored-clip order, moves it to the top, saves,
 * reloads and finds the order kept; then resets to the defaults so no other
 * spec sees a changed provider order. Locally no provider keys are set, so the
 * cards say "Not configured" — the order is still editable (skipped at run time).
 *
 * Self-contained: seeds an admin through /api/test/auth (E2E_TEST_MODE=true).
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

interface SeededUser { id: string; email: string; token: string }

async function seedAdmin(request: APIRequestContext): Promise<SeededUser> {
  const email = `audio-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const res = await request.post(`${API}/api/test/auth`, { data: { email, name: 'Audio admin', is_admin: true } });
  expect(res.ok()).toBeTruthy();
  const r = (await res.json()) as { user: { id: string }; session_token: string };
  return { id: r.user.id, email, token: r.session_token };
}

async function resetSettings(request: APIRequestContext, token: string) {
  await request.put(`${API}/api/admin/audio/settings`, {
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: JSON.stringify({ reset: true }),
  });
}

async function storedOrder(page: Page): Promise<string[]> {
  return page
    .getByTestId('audio-order-stored')
    .locator('.audio-order-row:not(.excluded)')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-provider') ?? ''));
}

test.use({ viewport: { width: 412, height: 915 } });

test.describe('admin: audio providers', () => {
  test('non-admins get 403 from the audio settings API', async ({ request }) => {
    const res = await request.post(`${API}/api/test/auth`, { data: { email: `audio-user-${Date.now()}@test.e2e`, name: 'Not admin' } });
    const { session_token } = (await res.json()) as { session_token: string };
    const r = await request.get(`${API}/api/admin/audio/settings`, { headers: { Authorization: `Bearer ${session_token}` } });
    expect(r.status()).toBe(403);
  });

  test('reorders the stored-clip providers, saves, and keeps it after a reload', async ({ page, request }) => {
    const admin = await seedAdmin(request);
    await resetSettings(request, admin.token);
    try {
      // From the Admin page's shortcut.
      await page.goto(`/admin?session_token=${admin.token}`);
      await page.getByRole('link', { name: /Audio providers/ }).click();
      await expect(page).toHaveURL(/\/admin\/audio$/);

      await expect(page.getByTestId('provider-card-minimax')).toBeVisible();
      await expect(page.getByTestId('provider-card-azure')).toBeVisible();
      await expect(page.getByTestId('provider-card-google')).toBeVisible();
      await expect(page.getByTestId('audio-save')).toBeDisabled();
      expect(await storedOrder(page)).toEqual(['minimax']);

      // Add Azure (appended last), then move it up to first.
      await page.getByTestId('order-include-stored-azure').check();
      expect(await storedOrder(page)).toEqual(['minimax', 'azure']);
      await page.getByTestId('order-up-stored-azure').click();
      expect(await storedOrder(page)).toEqual(['azure', 'minimax']);

      // An invalid value blocks Save with an inline problem; fixing it unblocks it.
      const rpm = page.getByTestId('provider-rpm-azure');
      await rpm.fill('0');
      await expect(page.getByTestId('audio-problems')).toContainText('max_rpm');
      await expect(page.getByTestId('audio-save')).toBeDisabled();
      await rpm.fill('15');
      await expect(page.getByTestId('audio-problems')).toHaveCount(0);

      await expect(page.getByTestId('audio-save')).toBeEnabled();
      await page.getByTestId('audio-save').click();
      await expect(page.getByText(/^Saved/)).toBeVisible();
      await expect(page.getByTestId('audio-save')).toBeDisabled();

      await page.reload();
      await expect(page.getByTestId('provider-card-azure')).toBeVisible();
      expect(await storedOrder(page)).toEqual(['azure', 'minimax']);

      // The server agrees.
      const res = await request.get(`${API}/api/admin/audio/settings`, { headers: { Authorization: `Bearer ${admin.token}` } });
      const body = (await res.json()) as { settings: { stored_order: string[]; live_order: string[] } };
      expect(body.settings.stored_order).toEqual(['azure', 'minimax']);
      expect(body.settings.live_order).toEqual(['minimax', 'google']);

      // Reset to defaults from the page (two-step confirm).
      await page.getByTestId('audio-reset').click();
      await page.getByTestId('audio-reset-confirm').click();
      await expect(page.getByText(/Back to the default settings/)).toBeVisible();
      expect(await storedOrder(page)).toEqual(['minimax']);
    } finally {
      await resetSettings(request, admin.token);
    }
  });
});
