/**
 * On-device debug console (Eruda) — devtools you can open on the phone
 * itself, since the Android app's WebView can't be inspected without a
 * desktop. Toggled from the user menu, or via ?debug=1 / ?debug=0 in the
 * URL (works with the chineselearning:// deep-link scheme too).
 *
 * Eruda is lazy-loaded only when enabled, so it costs nothing otherwise.
 */

const STORAGE_KEY = 'debug-console';

export function isDebugConsoleEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugConsoleEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — nothing to do
  }
}

/** Call once at app startup (before React renders). */
export function initDebugConsole(): void {
  const params = new URLSearchParams(window.location.search);
  const debugParam = params.get('debug');
  if (debugParam === '1') {
    setDebugConsoleEnabled(true);
  } else if (debugParam === '0') {
    setDebugConsoleEnabled(false);
  }

  if (isDebugConsoleEnabled()) {
    import('eruda')
      .then(({ default: eruda }) => {
        eruda.init();
      })
      .catch((err) => {
        console.error('[debugConsole] Failed to load eruda:', err);
      });
  }
}
