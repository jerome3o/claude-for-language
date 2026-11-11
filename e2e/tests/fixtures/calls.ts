import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Press "Join call" until the call is live. The pre-join page is still settling when the button
 * enables (the camera preview starting, the media card and the button's label changing), and a click
 * that lands mid-shift is lost — the page then still says "Join call" and a single click-and-wait
 * timed out (video-call-gloss / video-call-lessons, flaky in CI). A press while joining is a no-op
 * (the button is disabled then), so pressing again is safe.
 */
export async function pressJoin(page: Page, live: Locator = page.getByTestId('call-live')): Promise<void> {
  const button = page.getByTestId('join-call');
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await expect(async () => {
    if ((await button.isVisible()) && (await button.isEnabled({ timeout: 1000 }).catch(() => false))) await button.click({ timeout: 5000 });
    await expect(live).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
}
