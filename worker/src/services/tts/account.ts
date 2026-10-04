/**
 * MiniMax ACCOUNT problems (docs/AUDIO.md "Account problems"): no credit
 * (2053, 1008), a bad / revoked key (1004, 2049, HTTP 401 / 403). These are
 * not about the clip being made — every call fails the same way until the
 * account is fixed — so they must never burn a clip's attempts or push its
 * retry a day out (Oct 2026: 715 word clips ended up waiting until tomorrow
 * after the Starter plan was cancelled).
 *
 * Instead the TtsLimiter pauses EVERY MiniMax call (exponential: 5 → 10 → 20
 * → 40 → 60 min). When a pause is over, the next caller is let through as the
 * PROBE (one at a time); its outcome either clears the pause — then clips that
 * failed only with account errors are retried at once — or doubles it.
 * Pure state here; the Durable Object holds it, `resetAccountFailures` is the SQL.
 */

/** base_resp codes that mean "the account / key", not "this text". */
export const MINIMAX_ACCOUNT_CODES = new Set([
  1004, // authentication failed (invalid / expired key)
  1008, // insufficient balance
  2049, // invalid API key
  2053, // insufficient credit (no plan / top-up not attached to the key)
  2056, // plan usage limit for this 5-hour window
]);
/** HTTP statuses that mean the same. */
export const MINIMAX_ACCOUNT_HTTP = new Set([401, 403]);

export const ACCOUNT_PAUSE_MIN_MS = 5 * 60_000;
export const ACCOUNT_PAUSE_MAX_MS = 60 * 60_000;
/** A probe that never reports back (its worker died) frees the gate after this long. */
export const ACCOUNT_PROBE_TIMEOUT_MS = 60_000;

export interface AccountProblem {
  /** MiniMax base_resp code, or `http 401` / `http 403`. */
  code: number | string;
  message: string;
  /** Epoch ms the problem was first seen (stays while it lasts). */
  since: number;
  /** Epoch ms of the latest account error. */
  lastAt: number;
  /** Account errors in a row (sets the pause length). */
  streak: number;
  /** No MiniMax call before this (except the probe after it). */
  pausedUntil: number;
  /** A probe was let through and has not reported yet (epoch ms it was let through). */
  probeAt: number | null;
}

/** Pause after the `streak`-th account error in a row: 5, 10, 20, 40, 60, 60… min. */
export function accountPauseMs(streak: number): number {
  const n = Math.max(1, Math.floor(streak));
  return Math.min(ACCOUNT_PAUSE_MAX_MS, ACCOUNT_PAUSE_MIN_MS * 2 ** (n - 1));
}

/** The account code of a MiniMax answer, or null when it is about the clip / a blip. */
export function accountErrorCode(answer: { httpStatus?: number; code?: number | null }): number | string | null {
  if (answer.httpStatus !== undefined && MINIMAX_ACCOUNT_HTTP.has(answer.httpStatus)) return `http ${answer.httpStatus}`;
  if (typeof answer.code === 'number' && MINIMAX_ACCOUNT_CODES.has(answer.code)) return answer.code;
  return null;
}

/**
 * An account error happened: start the pause, or — when it was the PROBE that
 * failed — double it. Calls that were already in flight when the pause began
 * (the pump runs 3 at once) only refresh `lastAt`: they say nothing new.
 * `started` = the problem is new (→ one ntfy ping).
 */
export function noteAccountError(
  prev: AccountProblem | null,
  code: number | string,
  message: string,
  now: number,
): { problem: AccountProblem; started: boolean } {
  if (prev && prev.probeAt === null && now < prev.pausedUntil) {
    return { started: false, problem: { ...prev, lastAt: now } };
  }
  const streak = (prev?.streak ?? 0) + 1;
  return {
    started: prev === null,
    problem: {
      code,
      message: message.slice(0, 300),
      since: prev?.since ?? now,
      lastAt: now,
      streak,
      pausedUntil: now + accountPauseMs(streak),
      probeAt: null,
    },
  };
}

export type AccountGate =
  | { allowed: true; probe: boolean }
  | { allowed: false; retryAfterMs: number };

/**
 * May a MiniMax call go now? No problem → yes. Paused → no, until the pause
 * ends. After it: ONE caller is the probe; the rest wait for its outcome.
 */
export function accountGate(problem: AccountProblem | null, now: number): AccountGate {
  if (!problem) return { allowed: true, probe: false };
  if (now < problem.pausedUntil) return { allowed: false, retryAfterMs: problem.pausedUntil - now };
  if (problem.probeAt !== null && now - problem.probeAt < ACCOUNT_PROBE_TIMEOUT_MS) {
    return { allowed: false, retryAfterMs: problem.probeAt + ACCOUNT_PROBE_TIMEOUT_MS - now };
  }
  return { allowed: true, probe: true };
}

/** The gate let a probe through. */
export function markProbe(problem: AccountProblem, now: number): AccountProblem {
  return { ...problem, probeAt: now };
}

/**
 * What a call's outcome means for the problem: a clip, or MiniMax's own rate
 * limit, proves the account works → cleared. Anything else (a network blip, a
 * 5xx, a text MiniMax refuses) proves nothing → the probe gate opens again for
 * the next caller, the pause stays.
 */
export function noteCallOutcome(
  problem: AccountProblem | null,
  outcome: 'ok' | 'failed' | 'rate_limited' | 'network',
): { problem: AccountProblem | null; cleared: boolean } {
  if (!problem) return { problem: null, cleared: false };
  if (outcome === 'ok' || outcome === 'rate_limited') return { problem: null, cleared: true };
  return { problem: problem.probeAt === null ? problem : { ...problem, probeAt: null }, cleared: false };
}

// ---------- tts_clip_failures written by account errors ----------

/**
 * SQL condition on tts_clip_failures.last_error for "failed because of the
 * account" (the reasons callMiniMaxOnce writes: `base_resp <code> …`, `http <status>`).
 * `code` narrows it to one code (a base_resp number or an HTTP status).
 */
export function accountFailureCondition(code?: number | string | null): { sql: string; params: string[] } {
  if (code !== undefined && code !== null && String(code).trim() !== '') {
    const c = String(code).trim().replace(/^http\s+/, '');
    return { sql: '(last_error LIKE ? OR last_error LIKE ?)', params: [`base_resp ${c}%`, `http ${c}%`] };
  }
  const params = [
    ...[...MINIMAX_ACCOUNT_CODES].map((c) => `base_resp ${c}%`),
    ...[...MINIMAX_ACCOUNT_HTTP].map((s) => `http ${s}%`),
  ];
  return { sql: `(${params.map(() => 'last_error LIKE ?').join(' OR ')})`, params };
}

/**
 * Clips that failed with an account error (or with `code`) are due again now,
 * attempts back to 0 — the backfill picks them on its next pass. Returns how many.
 */
export async function resetAccountFailures(db: D1Database, opts: { code?: number | string | null; now?: number } = {}): Promise<number> {
  const cond = accountFailureCondition(opts.code);
  const nowIso = new Date(opts.now ?? Date.now()).toISOString();
  const res = await db
    .prepare(`UPDATE tts_clip_failures SET attempts = 0, next_attempt_at = ?, updated_at = datetime('now') WHERE ${cond.sql}`)
    .bind(nowIso, ...cond.params)
    .run();
  return res.meta?.changes ?? 0;
}
