/**
 * Web sign-in hand-off (shared/auth/signin.ts; worker services/auth.ts "one-time sign-in codes").
 *
 * "Sign in with Google" keeps a random verifier on this device and sends only its hash
 * (`challenge`); the worker's callback comes back with `?code=`, which is traded once for
 * the session token at POST /api/auth/exchange together with the verifier. A link that
 * carries someone else's code — or their session token (`?session_token=`, the old
 * hand-off) — can therefore no longer sign this browser in to their account (login CSRF).
 *
 * `?session_token=` is still accepted only (a) on the Vite dev server (E2E / screenshots
 * log in with it) and (b) inside a desktop app build from before the code exchange
 * (its preload doesn't say `signsInWithCode`); the desktop app now signs in by itself.
 */
import {
  AUTH_EXCHANGE_PATH,
  challengeFor,
  exchangeErrorMessage,
  loginUrlWithChallenge,
  makeVerifier,
  readSignInReturn,
  stripSignInParams,
} from '@shared/auth/signin';
import { API_BASE } from '../api/client';

const VERIFIER_KEY = 'auth_verifier';
/** A sign-in left unfinished longer than this is forgotten (Google + the callback take seconds). */
const VERIFIER_TTL_MS = 15 * 60 * 1000;

interface DesktopShell {
  isDesktop?: boolean;
  /** Desktop builds with the code exchange sign in themselves (desktop/src/auth.ts). */
  signsInWithCode?: boolean;
}

function desktopShell(): DesktopShell | null {
  const b = (window as Window & { desktopBridge?: DesktopShell }).desktopBridge;
  return b && b.isDesktop ? b : null;
}

/** May a `?session_token=` in the address bar sign this page in? */
export function acceptsLegacyToken(): boolean {
  if (import.meta.env.DEV) return true;
  const desktop = desktopShell();
  return !!desktop && !desktop.signsInWithCode;
}

function saveVerifier(verifier: string) {
  // sessionStorage is the tab's own; the localStorage copy covers a WebView / browser that
  // drops sessionStorage across the Google round trip. Both are this origin's only, which is
  // all the binding needs (another site can't write either).
  try { sessionStorage.setItem(VERIFIER_KEY, verifier); } catch { /* storage unavailable */ }
  try { localStorage.setItem(VERIFIER_KEY, JSON.stringify({ v: verifier, at: Date.now() })); } catch { /* storage unavailable */ }
}

function takeVerifier(now: number = Date.now()): string | null {
  let verifier: string | null = null;
  try { verifier = sessionStorage.getItem(VERIFIER_KEY); } catch { /* storage unavailable */ }
  if (!verifier) {
    try {
      const raw = localStorage.getItem(VERIFIER_KEY);
      const saved = raw ? (JSON.parse(raw) as { v?: unknown; at?: unknown }) : null;
      if (saved && typeof saved.v === 'string' && typeof saved.at === 'number' && now - saved.at < VERIFIER_TTL_MS) verifier = saved.v;
    } catch { /* unreadable */ }
  }
  try { sessionStorage.removeItem(VERIFIER_KEY); } catch { /* storage unavailable */ }
  try { localStorage.removeItem(VERIFIER_KEY); } catch { /* storage unavailable */ }
  return verifier;
}

/** Go to Google. `loginUrl` is `…/api/auth/login` (plus an invite). */
export async function startSignIn(loginUrl: string): Promise<void> {
  // The desktop app opens sign-in in the system browser and adds its own challenge;
  // an older desktop build expects the legacy token, so the page adds nothing there.
  if (desktopShell() || !globalThis.crypto?.subtle) {
    window.location.href = loginUrl;
    return;
  }
  const verifier = makeVerifier();
  saveVerifier(verifier);
  const challenge = await challengeFor(verifier);
  window.location.href = loginUrlWithChallenge(loginUrl, challenge, window.location.origin);
}

/** For `<a href>` sign-in links: start the hand-off instead of following the plain link. */
export function signInClick(loginUrl: string) {
  return (e: { preventDefault(): void }) => {
    e.preventDefault();
    void startSignIn(loginUrl);
  };
}

export type SignInResult =
  | { token: string; fresh: true }
  | { error: string; fresh: false }
  | null;

async function exchange(code: string): Promise<SignInResult> {
  const verifier = takeVerifier();
  if (!verifier) return { error: exchangeErrorMessage('no_verifier'), fresh: false };
  try {
    const res = await fetch(`${API_BASE}${AUTH_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    });
    const body = (await res.json().catch(() => ({}))) as { session_token?: string; reason?: string };
    if (res.ok && typeof body.session_token === 'string') return { token: body.session_token, fresh: true };
    return { error: exchangeErrorMessage(body.reason), fresh: false };
  } catch {
    return { error: exchangeErrorMessage('network'), fresh: false };
  }
}

let pending: Promise<SignInResult> | null = null;

/**
 * The sign-in redirect's result, once per page load (React StrictMode runs effects twice;
 * both get the same promise). Clears `code` / `session_token` from the address bar at once.
 * null = this load isn't a sign-in return.
 */
export function completeSignInFromUrl(): Promise<SignInResult> {
  if (pending) return pending;
  const { pathname, search, hash } = window.location;
  const ret = readSignInReturn(search);
  if (ret) window.history.replaceState(window.history.state, '', `${pathname}${stripSignInParams(search)}${hash}`);
  if (!ret) pending = Promise.resolve(null);
  else if (ret.kind === 'code') pending = exchange(ret.code);
  else pending = Promise.resolve(acceptsLegacyToken() ? { token: ret.token, fresh: true as const } : null);
  return pending;
}

/** Tests only. */
export function resetSignInForTests() {
  pending = null;
}
