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
}

export const DEFAULT_MINIMAX_RPM = 55;
export const DAY_BATCH_SHARE = 0.6;
export const NIGHT_BATCH_SHARE = 0.9;
/** After a 1002: everyone waits this long, batch work longer. */
export const RATE_LIMIT_BLOCK_MS = 15_000;
export const RATE_LIMIT_BATCH_BLOCK_MS = 60_000;

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
}

export function tryAcquire(prev: BucketState, cfg: LimiterConfig, priority: TtsPriority, now: number): AcquireResult {
  const state = refill(prev, cfg, now);
  const perMs = cfg.rpm / 60_000;
  const deny = (retryAfterMs: number): AcquireResult => ({
    state,
    granted: false,
    retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)),
    remaining: Math.floor(state.tokens),
  });

  if (now < state.blockedUntil) return deny(state.blockedUntil - now);

  if (priority === 'interactive') {
    if (state.tokens < 1) return deny((1 - state.tokens) / perMs);
    const next = { ...state, tokens: state.tokens - 1 };
    return { state: next, granted: true, retryAfterMs: 0, remaining: Math.floor(next.tokens) };
  }

  if (now < state.batchBlockedUntil) return deny(state.batchBlockedUntil - now);
  // Batch never takes the last global token (when the burst allows keeping one).
  const need = Math.min(2, cfg.burst);
  const globalWait = state.tokens < need ? (need - state.tokens) / perMs : 0;
  const batchWait = state.batchTokens < 1 ? (1 - state.batchTokens) / (perMs * cfg.batchShare) : 0;
  if (globalWait > 0 || batchWait > 0) return deny(Math.max(globalWait, batchWait));
  const next = { ...state, tokens: state.tokens - 1, batchTokens: state.batchTokens - 1 };
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
