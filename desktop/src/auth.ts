/**
 * Google sign-in for the desktop app. Google refuses OAuth in embedded browsers
 * ("This browser or app may not be secure"), and faking a browser user agent
 * to slip past that check is fragile and against Google's policy — so the app
 * does what the Lab app does: the web page's "Sign in with Google" link
 * (`…/api/auth/login`) opens in the SYSTEM browser with `client=desktop` and a
 * random nonce; after Google, the worker redirects to
 * `chineselearning-desktop://auth?session_token=…&nonce=…` (worker
 * NATIVE_AUTH_CLIENTS), the OS hands that link to this app, and the app loads
 * the web app with `?session_token=` — the same hand-off the web app already
 * uses after its own OAuth callback.
 */

import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import { desktopLoginUrl, parseAuthDeepLink, DESKTOP_NONCE_RE } from '../../shared/desktop/bridge';

let pendingNonce: string | null = null;

export function startSignIn(pageLoginUrl: string): void {
  const nonce = randomBytes(24).toString('base64url'); // 32 characters, [A-Za-z0-9_-]
  if (!DESKTOP_NONCE_RE.test(nonce)) return;
  pendingNonce = nonce;
  void shell.openExternal(desktopLoginUrl(pageLoginUrl, nonce));
}

/** The app was opened with a deep link: the query for the web app, or null when it isn't ours. */
export function takeAuthDeepLink(url: string): URLSearchParams | null {
  const params = parseAuthDeepLink(url, pendingNonce);
  if (params) pendingNonce = null;
  return params;
}
