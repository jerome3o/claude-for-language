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

/**
 * Screens where an automatic reload would destroy in-flight state: a study
 * session (in-memory queue, current card, reader progress), reading or
 * editing a graded reader, playing a quest, or composing in the coach /
 * tutor chat / AI-generation forms. On these the update reload is DEFERRED
 * until the user navigates somewhere harmless (home, lists, settings…) —
 * which every session eventually does. Everything not listed reloads
 * immediately, so updates still apply promptly.
 */
const UNSAFE_ROUTES: RegExp[] = [
  /^\/study(\/|$)/,   // study session (cards, readers, lessons mid-flight)
  /^\/readers\/.+/,   // reading or editing a reader; the /readers list is fine
  /^\/quests\/.+/,    // mid-quest; the /quests list is fine
  /^\/coach(\/|$)/,   // coach conversation + draft input
  /^\/generate(\/|$)/, // deck generation form
  /^\/analyze(\/|$)/, // sentence analysis input
  /\/chat\//,         // tutor-student chat (draft message)
];

function reloadIsDisruptive(): boolean {
  return UNSAFE_ROUTES.some(r => r.test(window.location.pathname));
}

export function initAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  // controllerchange also fires on the very first install (clientsClaim);
  // only reload for genuine updates of an already-controlled page.
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  let deferPoll: ReturnType<typeof setInterval> | null = null;

  const reloadNow = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading || deferPoll) return;
    if (!reloadIsDisruptive()) {
      reloadNow();
      return;
    }
    // Mid-activity: hold the reload and apply it as soon as the user lands
    // on a safe screen. (Router navigations don't fire a global event, so
    // poll the pathname — cheap, and it only runs while an update is
    // pending.) Note the new service worker HAS already taken control, so
    // a not-yet-visited lazy chunk could fail to load until this fires;
    // the ErrorBoundary's reload button covers that rare corner.
    deferPoll = setInterval(() => {
      if (!reloadIsDisruptive()) {
        if (deferPoll) clearInterval(deferPoll);
        reloadNow();
      }
    }, 3000);
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
