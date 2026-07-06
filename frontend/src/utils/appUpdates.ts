/**
 * Keeps the long-lived PWA / native-app WebView on the latest deploy.
 *
 * The service worker (vite-plugin-pwa, registerType 'autoUpdate') only looks
 * for a new version during registration — and an installed PWA or the native
 * app's WebView can stay alive for days without one. This module adds the
 * missing checks: whenever the app becomes visible (and hourly while open),
 * ask the service worker to update; the autoUpdate worker activates
 * immediately (skipWaiting + clientsClaim), and we reload on the controller
 * change so the new assets actually load.
 */

export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || 'unknown';

const HOURLY = 60 * 60 * 1000;

export function initAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  // controllerchange also fires on the very first install (clientsClaim);
  // only reload for genuine updates of an already-controlled page.
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const check = () => {
    navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, HOURLY);
}

/**
 * Manual "Update App" check. Returns:
 * - 'updating'   — a new version was found; the page reloads on its own
 * - 'latest'     — already on the newest deploy
 * - 'unsupported'— no service worker available (caller should fall back to a
 *                  hard cache clear)
 */
export async function checkForUpdateNow(): Promise<'updating' | 'latest' | 'unsupported'> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  await reg.update();
  if (reg.installing || reg.waiting) return 'updating';
  return 'latest';
}
