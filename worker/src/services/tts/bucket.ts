/**
 * The MiniMax rate limiter's arithmetic (pure; the TtsLimiter Durable Object
 * holds one state for the whole worker). docs/AUDIO.md "Rate limit".
 *
 * MiniMax limits requests per minute (RPM; `1002 rate limit exceeded(RPM)`).
 * A token bucket refilling at `rpm / 60` per second with a small burst keeps
 * any 60 s window at or under `rpm + burst`. Two priorities:
 * - interactive (a card just made or edited, a tap on ▶, a chat message):
 *   any token;
 * - batch (the backfill, imports, sentence sets): also needs a token from a
 *   second, slower bucket (`batchShare` of the rate — more at night), and
 *   never takes the global bucket's last token, so a tap is served next.
 * A 1002 / 429 from MiniMax empties both buckets and blocks for a while.
 *
 * The rate itself is LEARNED (AIMD, `AdaptiveState` below): the plan's real
 * RPM is unknown (Starter = 10/min, pay-as-you-go = 60/min, and it can change
 * without anyone telling us). Start at the persisted rate (8 on a first run),
 * ×1.25 (at least +2) after each full minute in which callers wanted more than
 * they got and MiniMax never said 1002 / 429 — 9 → 55 in 8 busy minutes —,
 * ×0.5 on a 1002 / 429; floor 2, capped at
 * `MINIMAX_RPM_MAX` (default 60) and at `MINIMAX_RPM` when that is set.
 */

export type TtsPriority = 'interactive' | 'batch';

export interface LimiterConfig {
  rpm: number;
  burst: number;
  /** Fraction of the rate batch work may use. */
  batchShare: number;
}

export interface BucketState {
  tokens: number;
  batchTokens: number;
  /** Epoch ms of the last refill. */
  at: number;
  /** No token for anyone before this (after a 1002). */
  blockedUntil: number;
  /** No batch token before this. */
  batchBlockedUntil: number;
  /**
   * An interactive caller was told to wait until about now: batch may not take
   * the next token before this (at 9/min the burst is 1 token, so without the
   * reservation a polling batch worker could take it from under a waiting tap).
   */
  interactiveReservedUntil?: number;
  /**
   * Batch slots promised to callers that were told to come back (ascending epoch
   * ms): a queue message requeued with its slot as the delay, a pump worker
   * sleeping until its slot. A caller presenting its ticket gets the token; others
   * may not take a token a booking needs. In memory only (a restart forgets them;
   * a returning holder then simply competes like everyone else).
   */
  bookings?: number[];
}

/** Asking for a batch slot (docs/AUDIO.md "Bookings"). */
export interface AcquireOptions {
  /** When refused: book the next free batch slot and return it as `ticket`. */
  book?: boolean;
  /** …only if that slot is at most this far away (an in-process waiter's deadline). */
  bookWithinMs?: number;
  /** The slot this caller booked earlier. */
  ticket?: number | null;
}

export const DEFAULT_MINIMAX_RPM = 55;
export const DAY_BATCH_SHARE = 0.6;
export const NIGHT_BATCH_SHARE = 0.9;
/** After a 1002: everyone waits this long, batch work longer. */
export const RATE_LIMIT_BLOCK_MS = 15_000;
export const RATE_LIMIT_BATCH_BLOCK_MS = 60_000;
/** How long past its retry time a waiting tap keeps the next token reserved. */
export const INTERACTIVE_RESERVE_GRACE_MS = 5_000;
/** A booking nobody claimed this long after its time is dropped. */
export const BOOKING_GRACE_MS = 30_000;
/** A booking whose time passed this long ago no longer holds others back (its owner may still claim it). */
export const BOOKING_LATE_MS = 2_000;
/** Bookings never reach further out than this (Queues' longest delay is 12 h). */
export const MAX_BOOKING_AHEAD_MS = 12 * 3600_000;
export const MAX_BOOKINGS = 5_000;

/** `MINIMAX_RPM` env → config. Default 55 (headroom under a 60 RPM plan). */
export function limiterConfig(rpmRaw: string | number | undefined, night = false): LimiterConfig {
  const parsed = Math.floor(Number(rpmRaw));
  const rpm = Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 10_000) : DEFAULT_MINIMAX_RPM;
  const burst = Math.max(1, Math.min(5, Math.floor(rpm / 10)));
  return { rpm, burst, batchShare: night ? NIGHT_BATCH_SHARE : DAY_BATCH_SHARE };
}

function batchCapacity(cfg: LimiterConfig): number {
  return Math.max(1, cfg.burst - 1);
}

export function initialState(cfg: LimiterConfig, now: number): BucketState {
  return { tokens: cfg.burst, batchTokens: batchCapacity(cfg), at: now, blockedUntil: 0, batchBlockedUntil: 0 };
}

export function refill(state: BucketState, cfg: LimiterConfig, now: number): BucketState {
  const elapsed = Math.max(0, now - state.at);
  const perMs = cfg.rpm / 60_000;
  return {
    ...state,
    tokens: Math.min(cfg.burst, state.tokens + elapsed * perMs),
    batchTokens: Math.min(batchCapacity(cfg), state.batchTokens + elapsed * perMs * cfg.batchShare),
    at: Math.max(state.at, now),
  };
}

export interface AcquireResult {
  state: BucketState;
  granted: boolean;
  /** When denied: how long until a token for this priority could be there. */
  retryAfterMs: number;
  /** Whole tokens left in the global bucket after this call. */
  remaining: number;
  /** When denied with a booking (new or still held): the slot to come back at. */
  ticket?: number;
}

/** Time between two batch tokens. */
export function batchIntervalMs(cfg: LimiterConfig): number {
  return 60_000 / Math.max(0.001, cfg.rpm * cfg.batchShare);
}

export function tryAcquire(prev: BucketState, cfg: LimiterConfig, priority: TtsPriority, now: number, opts: AcquireOptions = {}): AcquireResult {
  const state = refill(prev, cfg, now);
  const perMs = cfg.rpm / 60_000;
  const deny = (retryAfterMs: number): AcquireResult => ({
    state,
    granted: false,
    retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)),
    remaining: Math.floor(state.tokens),
  });

  if (priority === 'interactive') {
    const wait = now < state.blockedUntil ? state.blockedUntil - now : state.tokens < 1 ? (1 - state.tokens) / perMs : 0;
    if (wait > 0) {
      const res = deny(wait);
      // Hold the next token for this caller (it retries after `wait`).
      res.state = { ...state, interactiveReservedUntil: Math.max(state.interactiveReservedUntil ?? 0, now + res.retryAfterMs + INTERACTIVE_RESERVE_GRACE_MS) };
      return res;
    }
    const next = { ...state, tokens: state.tokens - 1, interactiveReservedUntil: 0 };
    return { state: next, granted: true, retryAfterMs: 0, remaining: Math.floor(next.tokens) };
  }

  // ---- batch: bookings first (FIFO), then the bucket ----
  const allBookings = state.bookings ?? [];
  const bookings = allBookings.filter((b) => b >= now - BOOKING_GRACE_MS);
  const base: BucketState = bookings.length !== allBookings.length ? { ...state, bookings } : state;
  const ticket = opts.ticket ?? null;
  const holder = ticket !== null && bookings.includes(ticket);
  const interval = batchIntervalMs(cfg);
  const lineEnd = bookings.length ? bookings[bookings.length - 1] + interval : now;
  const denyBatch = (waitMs: number): AcquireResult => {
    const wait = Math.max(1, Math.ceil(waitMs));
    if (holder) {
      // Keep the place: come back when both the token and the slot are there.
      return { state: base, granted: false, retryAfterMs: Math.max(wait, Math.ceil(ticket! - now)), remaining: Math.floor(base.tokens), ticket: ticket! };
    }
    if (opts.book) {
      const slot = Math.ceil(Math.max(now + wait, lineEnd));
      if (slot - now <= (opts.bookWithinMs ?? MAX_BOOKING_AHEAD_MS) && bookings.length < MAX_BOOKINGS) {
        return { state: { ...base, bookings: [...bookings, slot] }, granted: false, retryAfterMs: slot - now, remaining: Math.floor(base.tokens), ticket: slot };
      }
    }
    // No booking: told when the line ends (or the token, whichever is later).
    return { state: base, granted: false, retryAfterMs: Math.max(wait, Math.ceil(lineEnd - now)), remaining: Math.floor(base.tokens) };
  };

  if (holder && now < ticket! - 1_000) return denyBatch(ticket! - now);
  if (now < base.blockedUntil) return denyBatch(base.blockedUntil - now);
  if (now < base.batchBlockedUntil) return denyBatch(base.batchBlockedUntil - now);
  if (now < (base.interactiveReservedUntil ?? 0)) return denyBatch((base.interactiveReservedUntil ?? 0) - now);
  // Someone holds a booking that the next token belongs to: wait in line.
  if (!holder && bookings.some((b) => b >= now - BOOKING_LATE_MS && b <= now + interval)) return denyBatch(lineEnd - now);
  // Batch never takes the last global token (when the burst allows keeping one).
  const need = Math.min(2, cfg.burst);
  const globalWait = base.tokens < need ? (need - base.tokens) / perMs : 0;
  // A holder's slot already IS the batch pacing (slots are an interval apart), so it may
  // run one batch token into debt: a queue delivery a second late must not cost a requeue.
  const batchNeed = holder ? 0 : 1;
  const batchWait = base.batchTokens < batchNeed ? (batchNeed - base.batchTokens) / (perMs * cfg.batchShare) : 0;
  if (globalWait > 0 || batchWait > 0) return denyBatch(Math.max(globalWait, batchWait));
  const left = holder ? bookings.filter((b) => b !== ticket) : bookings;
  const next: BucketState = { ...base, tokens: base.tokens - 1, batchTokens: base.batchTokens - 1, ...(left !== bookings || base.bookings ? { bookings: left } : {}) };
  return { state: next, granted: true, retryAfterMs: 0, remaining: Math.floor(next.tokens) };
}

/** MiniMax said 1002 / 429: empty the buckets and block. */
export function penalize(prev: BucketState, cfg: LimiterConfig, now: number): BucketState {
  const state = refill(prev, cfg, now);
  return {
    ...state,
    tokens: 0,
    batchTokens: 0,
    blockedUntil: Math.max(state.blockedUntil, now + RATE_LIMIT_BLOCK_MS),
    batchBlockedUntil: Math.max(state.batchBlockedUntil, now + RATE_LIMIT_BATCH_BLOCK_MS),
  };
}

// ---------- Adaptive rate (AIMD) ----------

export const ADAPTIVE_START_RPM = 8;
export const ADAPTIVE_FLOOR_RPM = 2;
/** Smallest increase after a clean busy minute… */
export const ADAPTIVE_STEP_RPM = 2;
/** …and the multiplicative one (whichever is bigger): 9 → 12 → 15 → 19 → 24 → 30 → 38 → 48 → 55. */
export const ADAPTIVE_INCREASE = 1.25;
export const ADAPTIVE_DECREASE = 0.5;
export const DEFAULT_MINIMAX_RPM_MAX = 60;
export const ADAPTIVE_HISTORY = 30;
const MINUTE_MS = 60_000;

export interface AdaptiveBounds {
  floor: number;
  cap: number;
}

export interface RateChange {
  at: number;
  rpm: number;
  from: number;
  reason: 'start' | 'increase' | 'rate_limited' | 'bounds';
}

export interface AdaptiveState {
  /** The learned requests per minute (whole number). */
  rpm: number;
  /** Start of the minute being observed. */
  windowStart: number;
  /** Someone was refused a slot in this minute (the rate was the constraint). */
  demand: boolean;
  /** MiniMax said 1002 / 429 in this minute. */
  rateLimited: boolean;
  lastRateLimitedAt: number | null;
  /** Newest last, ≤ ADAPTIVE_HISTORY. */
  history: RateChange[];
}

function positiveInt(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : null;
}

/** `MINIMAX_RPM_MAX` (default 60) and `MINIMAX_RPM` (a hard cap when set) → bounds. */
export function adaptiveBounds(rpmRaw: string | number | undefined, maxRaw: string | number | undefined): AdaptiveBounds {
  const hard = positiveInt(rpmRaw);
  const max = positiveInt(maxRaw) ?? DEFAULT_MINIMAX_RPM_MAX;
  const cap = Math.max(ADAPTIVE_FLOOR_RPM, hard === null ? max : Math.min(max, hard));
  return { floor: ADAPTIVE_FLOOR_RPM, cap };
}

function clampRpm(rpm: number, b: AdaptiveBounds): number {
  return Math.max(b.floor, Math.min(b.cap, Math.round(rpm)));
}

function pushHistory(history: RateChange[], change: RateChange): RateChange[] {
  return [...history, change].slice(-ADAPTIVE_HISTORY);
}

/** From what was persisted (a restart keeps the learned rate), else the start rate; clamped to today's bounds. */
export function initialAdaptive(b: AdaptiveBounds, now: number, saved?: Partial<AdaptiveState> | null): AdaptiveState {
  const from = typeof saved?.rpm === 'number' && Number.isFinite(saved.rpm) ? saved.rpm : null;
  const rpm = clampRpm(from ?? ADAPTIVE_START_RPM, b);
  let history = Array.isArray(saved?.history) ? saved!.history.slice(-ADAPTIVE_HISTORY) : [];
  if (from === null) history = pushHistory(history, { at: now, rpm, from: rpm, reason: 'start' });
  else if (rpm !== from) history = pushHistory(history, { at: now, rpm, from, reason: 'bounds' });
  return {
    rpm,
    windowStart: now,
    demand: false,
    rateLimited: false,
    lastRateLimitedAt: typeof saved?.lastRateLimitedAt === 'number' ? saved.lastRateLimitedAt : null,
    history,
  };
}

/**
 * Close the observed minute once it is over: ×1.25 (≥ +2) when it saw demand and no
 * rate limit. Only the minute that was observed counts — a quiet gap after it
 * earns nothing (no demand there).
 */
export function rollAdaptive(prev: AdaptiveState, b: AdaptiveBounds, now: number): AdaptiveState {
  let state = prev;
  const bounded = clampRpm(state.rpm, b);
  if (bounded !== state.rpm) {
    state = { ...state, rpm: bounded, history: pushHistory(state.history, { at: now, rpm: bounded, from: state.rpm, reason: 'bounds' }) };
  }
  if (now - state.windowStart < MINUTE_MS) return state;
  let rpm = state.rpm;
  let history = state.history;
  if (state.demand && !state.rateLimited && rpm < b.cap) {
    const next = clampRpm(nextIncrease(rpm), b);
    history = pushHistory(history, { at: state.windowStart + MINUTE_MS, rpm: next, from: rpm, reason: 'increase' });
    rpm = next;
  }
  const elapsed = Math.floor((now - state.windowStart) / MINUTE_MS);
  return { ...state, rpm, history, windowStart: state.windowStart + elapsed * MINUTE_MS, demand: false, rateLimited: false };
}

/** One clean busy minute's step up (before the cap). */
export function nextIncrease(rpm: number): number {
  return Math.max(rpm + ADAPTIVE_STEP_RPM, Math.ceil(rpm * ADAPTIVE_INCREASE));
}

/** A request was refused a slot (or granted — `refused: false` just rolls the window). */
export function noteRequest(prev: AdaptiveState, b: AdaptiveBounds, now: number, refused: boolean): AdaptiveState {
  const state = rollAdaptive(prev, b, now);
  return refused && !state.demand ? { ...state, demand: true } : state;
}

/** MiniMax said 1002 / 429: halve, and the next full clean minute starts now. */
export function noteRateLimited(prev: AdaptiveState, b: AdaptiveBounds, now: number): AdaptiveState {
  const state = rollAdaptive(prev, b, now);
  const rpm = clampRpm(Math.floor(state.rpm * ADAPTIVE_DECREASE), b);
  return {
    ...state,
    rpm,
    windowStart: now,
    demand: false,
    rateLimited: true,
    lastRateLimitedAt: now,
    history: pushHistory(state.history, { at: now, rpm, from: state.rpm, reason: 'rate_limited' }),
  };
}
