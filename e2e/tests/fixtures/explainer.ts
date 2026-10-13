import type { BrowserContext } from '@playwright/test';

/**
 * Mark the first-card explainer ("Before your first card", components/onboarding/FirstCardExplainer.tsx)
 * as seen before any page loads. It decides whether to show from a live IndexedDB count, so it pops
 * up a moment AFTER the card — and on an account with server-side reviews it shows until the sync
 * brings them down, then vanishes. Specs that study a card and aren't about the explainer used to
 * click "Got it" if it happened to be visible at that instant, which raced both ways in CI (the
 * explainer covering the reveal button, or "Got it" detached mid-click). The explainer has its own
 * spec (first-card-explainer.spec.ts).
 */
export async function skipFirstCardExplainer(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('firstCardExplainerSeen', '1');
    } catch {
      /* ignore */
    }
  });
}
