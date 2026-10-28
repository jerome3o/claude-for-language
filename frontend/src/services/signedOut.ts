/**
 * The signed-out state (CLAUDE.md "Sign-in & sessions", shared/auth/session.ts): a 401 from our
 * API while this device thinks it is signed in. The app keeps running on its local data — study,
 * IndexedDB, every outbox stay as they are — and `SignedOutBanner` says so on every screen with
 * Sign in. Persisted (localStorage), so a reload or a cold start still shows it. Cleared by the
 * next successful authenticated request or a sign-in.
 *
 * Before: a 401 anywhere set the user to null (the sign-in page, offline study gone) and a 401
 * on /auth/me at start threw the session and the cached user away.
 */
import { useSyncExternalStore } from 'react';
import { countsForSignedOut, signedOutWhere, type SignedOutWhere } from '@shared/auth/session';

const KEY = 'signed-out-v1';

export interface SignedOutState {
  since: number;
  where: SignedOutWhere;
}

function load(): SignedOutState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SignedOutState>;
    return typeof v.since === 'number' ? { since: v.since, where: (v.where ?? 'other') as SignedOutWhere } : null;
  } catch {
    return null;
  }
}

let state: SignedOutState | null = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSignedOut(): SignedOutState | null {
  return state;
}

export function isSignedOut(): boolean {
  return state !== null;
}

/**
 * A 401 from our API at `path` (an API path such as `/api/sync/changes`, or a full URL). Signing
 * out itself and the code exchange never count. Returns true when this started a signed-out spell.
 */
export function markSignedOut(path = ''): boolean {
  // fetchJSON passes '/auth/me' (relative to /api); other callers a full API path or URL.
  const full = !path || path.startsWith('/api') || /^https?:/.test(path) ? path : `/api${path}`;
  if (full && !countsForSignedOut(full)) return false;
  if (state) return false;
  const where = signedOutWhere(full);
  state = { since: Date.now(), where };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: memory only */ }
  void import('./analytics').then((m) => m.track('auth.signed_out_detected', { platform: 'web', where })).catch(() => {});
  emit();
  return true;
}

/** A successful authenticated request or a sign-in: the banner goes. */
export function clearSignedOut(): void {
  if (!state) return;
  state = null;
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  emit();
}

export function subscribeSignedOut(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSignedOut(): SignedOutState | null {
  return useSyncExternalStore(subscribeSignedOut, getSignedOut, getSignedOut);
}

/** Tests only. */
export function resetSignedOutForTests(): void {
  state = load();
  emit();
}
