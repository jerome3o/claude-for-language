/**
 * Google sign-in for the desktop app. Google refuses OAuth in embedded browsers
 * ("This browser or app may not be secure"), and faking a browser user agent
 * to slip past that check is fragile and against Google's policy — so the app
 * does what the Lab app does: the web page's "Sign in with Google" link
 * (`…/api/auth/login`) opens in the SYSTEM browser with `client=desktop`, a
 * random nonce and the PKCE challenge of a verifier only this process knows
 * (shared/auth/signin.ts); after Google, the worker redirects to
 * `chineselearning-desktop://auth?code=…&nonce=…` (worker NATIVE_AUTH_CLIENTS),
 * the OS hands that link to this app, the app trades code + verifier for the
 * session at POST /api/auth/exchange and gives the token to the page in its own
 * storage (main.ts) — the session token never travels in a URL.
 */

import { randomBytes } from 'node:crypto';
import { shell } from 'electron';
import { desktopLoginUrl, parseAuthDeepLink, DESKTOP_NONCE_RE } from '../../shared/desktop/bridge';
import { AUTH_EXCHANGE_PATH, challengeFor, exchangeErrorMessage, makeVerifier } from '../../shared/auth/signin';

let pendingNonce: string | null = null;
let pendingVerifier: string | null = null;

export async function startSignIn(pageLoginUrl: string): Promise<void> {
  const nonce = randomBytes(24).toString('base64url'); // 32 characters, [A-Za-z0-9_-]
  if (!DESKTOP_NONCE_RE.test(nonce)) return;
  const verifier = makeVerifier();
  pendingNonce = nonce;
  pendingVerifier = verifier;
  await shell.openExternal(desktopLoginUrl(pageLoginUrl, nonce, await challengeFor(verifier)));
}

/** The app was opened with a deep link: its query (code / signup / error), or null when it isn't ours. */
export function takeAuthDeepLink(url: string): { params: URLSearchParams; verifier: string | null } | null {
  const params = parseAuthDeepLink(url, pendingNonce);
  if (!params) return null;
  const verifier = pendingVerifier;
  pendingNonce = null;
  pendingVerifier = null;
  return { params, verifier };
}

export type ExchangeOutcome = { token: string } | { error: string };

/** POST code + verifier to the worker; the session token, or a sentence for the sign-in screen. */
export async function exchangeCode(apiUrl: string, code: string, verifier: string | null): Promise<ExchangeOutcome> {
  if (!verifier) return { error: exchangeErrorMessage('no_verifier') };
  try {
    const res = await fetch(`${apiUrl}${AUTH_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    });
    const body = (await res.json().catch(() => ({}))) as { session_token?: unknown; reason?: string };
    if (res.ok && typeof body.session_token === 'string') return { token: body.session_token };
    return { error: exchangeErrorMessage(body.reason) };
  } catch {
    return { error: exchangeErrorMessage('network') };
  }
}
