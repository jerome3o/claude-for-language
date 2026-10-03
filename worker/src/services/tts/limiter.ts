/**
 * Asking the TtsLimiter Durable Object for a MiniMax slot (docs/AUDIO.md).
 * Interactive callers may wait a few seconds for one; batch callers never wait
 * — they are told how long until a slot and requeue themselves.
 * Without the binding (unit tests, a misconfigured deploy) calls go straight
 * through: a broken limiter must not silence every card.
 */
import type { Env } from '../../types';
import type { TtsPriority } from './bucket';

export const LIMITER_NAME = 'minimax';
/** Longest an interactive caller waits for a slot before giving up (and queueing). */
export const INTERACTIVE_MAX_WAIT_MS = 8_000;

type LimiterEnv = Pick<Env, 'TTS_LIMITER'>;

function stub(env: LimiterEnv) {
  return env.TTS_LIMITER ? env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(LIMITER_NAME)) : null;
}

export type SlotResult = { granted: true } | { granted: false; retryAfterMs: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireTtsSlot(env: LimiterEnv, priority: TtsPriority, maxWaitMs = priority === 'interactive' ? INTERACTIVE_MAX_WAIT_MS : 0): Promise<SlotResult> {
  const limiter = stub(env);
  if (!limiter) return { granted: true };
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    let res: { granted: boolean; retryAfterMs: number };
    try {
      res = await limiter.acquire(priority);
    } catch (err) {
      console.error('[tts-limiter] acquire failed, going ahead:', err instanceof Error ? err.message : err);
      return { granted: true };
    }
    if (res.granted) return { granted: true };
    const wait = res.retryAfterMs;
    if (Date.now() + wait > deadline) return { granted: false, retryAfterMs: wait };
    await sleep(wait);
  }
}

export async function reportTts(env: LimiterEnv, outcome: 'ok' | 'failed' | 'rate_limited'): Promise<void> {
  const limiter = stub(env);
  if (!limiter) return;
  try {
    await limiter.report(outcome);
  } catch (err) {
    console.error('[tts-limiter] report failed:', err instanceof Error ? err.message : err);
  }
}
