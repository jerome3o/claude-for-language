/**
 * Asking a TtsLimiter Durable Object for a slot (docs/AUDIO.md). One instance
 * per provider (idFromName = minimax | azure | google): each has its own
 * learned rate and its own account pause.
 * Interactive callers may wait a few seconds for one; batch callers never wait
 * — they are told how long until a slot and requeue themselves.
 * Without the binding (unit tests, a misconfigured deploy) calls go straight
 * through: a broken limiter must not silence every card.
 */
import type { Env } from '../../types';
import type { TtsPriority } from './bucket';

import type { TtsProviderId } from '@shared/tts';

/** The MiniMax instance (kept its old name so the learned rate / account state survive). */
export const LIMITER_NAME = 'minimax';

/** Who is asking: the provider (= the DO instance) and its admin-set cap. */
export interface LimiterTarget {
  provider: TtsProviderId;
  maxRpm?: number;
}
/** Longest an interactive caller waits for a slot before giving up (and queueing). */
export const INTERACTIVE_MAX_WAIT_MS = 8_000;

type LimiterEnv = Pick<Env, 'TTS_LIMITER'>;

export function limiterStub(env: LimiterEnv, provider: TtsProviderId = 'minimax') {
  return env.TTS_LIMITER ? env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(provider)) : null;
}

/**
 * `account` = refused because the provider's account is paused (no credit / bad key;
 * services/tts/account.ts). `ticket` = a batch slot booked for this caller: come back
 * after `retryAfterMs` and present it (docs/AUDIO.md "Bookings").
 */
export type SlotResult = { granted: true } | { granted: false; retryAfterMs: number; account?: number | string; ticket?: number };
export type TtsReport = 'ok' | 'failed' | 'rate_limited' | 'network' | 'account_error';

export interface SlotOptions {
  /** A batch caller that will requeue itself: book the next free slot (up to 12 h out) and return it. */
  book?: boolean;
  /** A slot booked earlier with this provider. */
  ticket?: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One slot, or how long to wait. Interactive callers wait up to `maxWaitMs` (polling).
 * A BATCH caller that waits in process (the pump, lesson / audio-lesson jobs) books a
 * slot within its deadline and sleeps until it: two limiter calls per clip, instead
 * of three workers polling every few seconds and colliding.
 */
export async function acquireTtsSlot(
  env: LimiterEnv,
  priority: TtsPriority,
  maxWaitMs = priority === 'interactive' ? INTERACTIVE_MAX_WAIT_MS : 0,
  target: LimiterTarget = { provider: 'minimax' },
  opts: SlotOptions = {},
): Promise<SlotResult> {
  const limiter = limiterStub(env, target.provider);
  if (!limiter) return { granted: true };
  const deadline = Date.now() + maxWaitMs;
  let ticket = opts.ticket ?? null;
  for (;;) {
    let res: { granted: boolean; retryAfterMs: number; account?: number | string | null; ticket?: number | null };
    const left = deadline - Date.now();
    const waitsHere = priority === 'batch' && left > 0;
    try {
      res = await limiter.acquire(
        priority,
        target,
        priority === 'batch' ? { ticket, book: waitsHere || !!opts.book, bookWithinMs: waitsHere ? left : undefined } : undefined,
      );
    } catch (err) {
      console.error('[tts-limiter] acquire failed, going ahead:', err instanceof Error ? err.message : err);
      return { granted: true };
    }
    if (res.granted) return { granted: true };
    const wait = res.retryAfterMs;
    if (res.account !== undefined && res.account !== null) return { granted: false, retryAfterMs: wait, account: res.account };
    if (typeof res.ticket === 'number') ticket = res.ticket;
    if (Date.now() + wait > deadline) return { granted: false, retryAfterMs: wait, ...(ticket !== null ? { ticket } : {}) };
    await sleep(wait);
  }
}

/** What a call did. For `account_error` returns how long every call is now paused (ms). */
export async function reportTts(
  env: LimiterEnv,
  outcome: TtsReport,
  detail?: { code: number | string; message: string },
  target: LimiterTarget = { provider: 'minimax' },
): Promise<number | undefined> {
  const limiter = limiterStub(env, target.provider);
  if (!limiter) return undefined;
  try {
    const res = await limiter.report(outcome, detail, target);
    return res?.pausedForMs ?? undefined;
  } catch (err) {
    console.error('[tts-limiter] report failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}
