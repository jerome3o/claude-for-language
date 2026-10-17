/**
 * A provider whose account is paused (MiniMax out of credit) is skipped without a
 * limiter call on every clip (docs/AUDIO.md "Queue churn"); the isolate forgets the
 * pause after KNOWN_PAUSE_MAX_MS so the probe still happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callProviderTTS, forgetKnownAccountPauses, KNOWN_PAUSE_MAX_MS } from '../audio';
import type { Env } from '../../types';

let acquires: string[];

function env(answer: { granted: boolean; retryAfterMs: number; account?: number }): Env {
  return {
    MINIMAX_API_KEY: 'k',
    TTS_LIMITER: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        acquire: async () => {
          acquires.push(name);
          return { ...answer, remaining: 0 };
        },
        report: async () => ({}),
      }),
    },
  } as unknown as Env;
}

beforeEach(() => {
  acquires = [];
  forgetKnownAccountPauses();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-16T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('known account pauses', () => {
  it('asks the paused limiter once, then skips it until the remembered pause runs out', async () => {
    const e = env({ granted: false, retryAfterMs: 40 * 60_000, account: 2053 });
    const first = await callProviderTTS(e, 'minimax', { text: '你好', voice: 'v', rate: 0.6 }, { priority: 'batch' });
    expect(first).toMatchObject({ ok: false, rateLimited: true, account: 2053, reason: 'account paused' });
    for (let i = 0; i < 50; i++) await callProviderTTS(e, 'minimax', { text: '你好', voice: 'v', rate: 0.6 }, { priority: 'batch' });
    expect(acquires).toEqual(['minimax']);
    // at most KNOWN_PAUSE_MAX_MS later the limiter is asked again (it decides the probe)
    vi.setSystemTime(Date.now() + KNOWN_PAUSE_MAX_MS);
    await callProviderTTS(e, 'minimax', { text: '你好', voice: 'v', rate: 0.6 }, { priority: 'batch' });
    expect(acquires).toEqual(['minimax', 'minimax']);
  });

  it('a plain rate limit is not remembered (every caller asks)', async () => {
    const e = env({ granted: false, retryAfterMs: 5_000 });
    await callProviderTTS(e, 'minimax', { text: '你好', voice: 'v', rate: 0.6 }, { priority: 'batch' });
    await callProviderTTS(e, 'minimax', { text: '你好', voice: 'v', rate: 0.6 }, { priority: 'batch' });
    expect(acquires).toHaveLength(2);
  });
});
