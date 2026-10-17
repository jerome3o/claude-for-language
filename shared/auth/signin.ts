/**
 * The sign-in hand-off every app shares (worker services/auth.ts "one-time sign-in codes").
 *
 * Before leaving for Google the app makes a random `verifier`, keeps it, and sends only
 * `challenge = base64url(SHA-256(verifier))` to `/api/auth/login?challenge=` (PKCE S256).
 * Google → the worker's callback → the app with `?code=` (web) or
 * `chineselearning-{lab,desktop}://auth?code=&nonce=` (native). The app POSTs
 * `{ code, verifier }` to `/api/auth/exchange` and gets the session token. The token
 * never travels in a URL, and a code is useless without the verifier this app kept —
 * so a link carrying someone else's code can't sign you in to their account.
 *
 * Pure: WebCrypto only (browsers, Node ≥ 20, Electron). The Lab app's port is
 * android-lab/app/…/data/AuthExchange.kt.
 */

export const AUTH_EXCHANGE_PATH = '/api/auth/exchange';

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url (43 characters). */
export function makeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256 challenge of a verifier: base64url(SHA-256(verifier)), no padding (43 characters). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The login URL with the challenge added (any other query — an invite — is kept). */
export function loginUrlWithChallenge(loginUrl: string, challenge: string, base?: string): string {
  const u = new URL(loginUrl, base);
  u.searchParams.set('challenge', challenge);
  return u.toString();
}

/** What the sign-in redirect brought back in the web app's query string. */
export type SignInReturn =
  | { kind: 'code'; code: string }
  | { kind: 'token'; token: string }
  | null;

export function readSignInReturn(search: string): SignInReturn {
  const q = new URLSearchParams(search);
  const code = q.get('code');
  if (code) return { kind: 'code', code };
  const token = q.get('session_token');
  if (token) return { kind: 'token', token };
  return null;
}

/** The query without the sign-in parameters (what the address bar should keep). */
export function stripSignInParams(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('code');
  q.delete('session_token');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Why /api/auth/exchange refused (its `reason`), as a sentence for the sign-in screen. */
export function exchangeErrorMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'expired':
      return 'That sign-in took too long. Please sign in again.';
    case 'nonce_mismatch':
    case 'no_verifier':
      return 'That sign-in link wasn’t started on this device. Please sign in again.';
    case 'invalid_code':
      return 'That sign-in link was already used. Please sign in again.';
    case 'network':
      return 'Couldn’t finish signing in — check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}
