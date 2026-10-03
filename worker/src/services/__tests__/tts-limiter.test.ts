/**
 * The MiniMax rate limiter (docs/AUDIO.md "Rate limit"): token bucket under the
 * RPM, interactive before batch, a 1002 empties the buckets; the Durable Object
 * that holds it; the nightly cron's London-midnight check across DST.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MINIMAX_RPM,
  initialState,
  limiterConfig,
  penalize,
  tryAcquire,
  RATE_LIMIT_BATCH_BLOCK_MS,
  RATE_LIMIT_BLOCK_MS,
  type BucketState,
  type TtsPriority,
} from '../tts/bucket';
import { TtsLimiter } from '../../durable/tts-limiter';
import { isLondonMidnight, londonHour } from '../tts/schedule';
import { runAudioCron } from '../tts/cron';
import { requeueDelaySeconds } from '../tts/queue';
import type { Env } from '../../types';

/** Grant as many as the bucket allows, one attempt every `stepMs`, for `ms`. */
function simulate(priority: TtsPriority, rpm: number, ms: number, stepMs = 50, night = false): number[] {
  const cfg = limiterConfig(rpm, night);
  let state: BucketState = initialState(cfg, 0);
  const grants: number[] = [];
  for (let t = 0; t <= ms; t += stepMs) {
    const r = tryAcquire(state, cfg, priority, t);
    state = r.state;
    if (r.granted) grants.push(t);
  }
  return grants;
}

function maxInAnyWindow(times: number[], windowMs: number): number {
  let max = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] >= windowMs) j++;
    max = Math.max(max, i - j + 1);
  }
  return max;
}

describe('token bucket', () => {
  it('defaults to 55 RPM, configurable, nonsense → default', () => {
    expect(limiterConfig(undefined).rpm).toBe(DEFAULT_MINIMAX_RPM);
    expect(limiterConfig('20').rpm).toBe(20);
    expect(limiterConfig('abc').rpm).toBe(55);
    expect(limiterConfig('0').rpm).toBe(55);
    expect(limiterConfig('55').burst).toBe(5);
    expect(limiterConfig('8').burst).toBe(1);
  });

  it.each([55, 30, 10])('never more than rpm + burst (≤ 60 at the default) in any 60 s window — %i RPM', (rpm) => {
    const grants = simulate('interactive', rpm, 10 * 60_000);
    const cfg = limiterConfig(rpm);
    expect(maxInAnyWindow(grants, 60_000)).toBeLessThanOrEqual(rpm + cfg.burst);
    // …and it does use the rate: 10 minutes ≈ 10 × rpm.
    expect(grants.length).toBeGreaterThanOrEqual(rpm * 10 - 1);
  });

  it('the default stays under a 60 RPM plan', () => {
    expect(maxInAnyWindow(simulate('interactive', 55, 10 * 60_000), 60_000)).toBeLessThanOrEqual(60);
  });

  it('batch work gets only its share — less by day than at night', () => {
    const day = simulate('batch', 55, 10 * 60_000).length;
    const night = simulate('batch', 55, 10 * 60_000, 50, true).length;
    expect(day).toBeLessThanOrEqual(Math.ceil(55 * 0.6 * 10) + 5);
    expect(night).toBeGreaterThan(day);
    expect(night).toBeLessThanOrEqual(Math.ceil(55 * 0.9 * 10) + 5);
  });

  it('interactive goes first: batch never takes the last token, and says how long to wait', () => {
    const cfg = limiterConfig(55);
    let state: BucketState = { ...initialState(cfg, 0), tokens: 1.5, batchTokens: 4 };
    const batch = tryAcquire(state, cfg, 'batch', 0);
    expect(batch.granted).toBe(false);
    expect(batch.retryAfterMs).toBeGreaterThan(0);
    const tap = tryAcquire(state, cfg, 'interactive', 0);
    expect(tap.granted).toBe(true);
    state = tap.state;
    expect(tryAcquire(state, cfg, 'interactive', 0).granted).toBe(false);
  });

  it('with batch saturating the bucket, a tap still gets a slot within ~a second', () => {
    const cfg = limiterConfig(55);
    let state = initialState(cfg, 0);
    for (let t = 0; t < 60_000; t += 10) state = tryAcquire(state, cfg, 'batch', t).state;
    let waited = 0;
    for (let t = 60_000; ; t += 10) {
      const r = tryAcquire(state, cfg, 'interactive', t);
      state = r.state;
      if (r.granted) break;
      waited += 10;
    }
    expect(waited).toBeLessThanOrEqual(1100);
  });

  it('a 1002 empties both buckets and blocks everyone, batch longer', () => {
    const cfg = limiterConfig(55);
    const state = penalize(initialState(cfg, 0), cfg, 1000);
    expect(state.tokens).toBe(0);
    expect(tryAcquire(state, cfg, 'interactive', 1000 + RATE_LIMIT_BLOCK_MS - 1).granted).toBe(false);
    expect(tryAcquire(state, cfg, 'interactive', 1000 + RATE_LIMIT_BLOCK_MS + 1).granted).toBe(true);
    const batch = tryAcquire(state, cfg, 'batch', 1000 + RATE_LIMIT_BLOCK_MS + 1);
    expect(batch.granted).toBe(false);
    expect(batch.retryAfterMs).toBeGreaterThan(RATE_LIMIT_BATCH_BLOCK_MS - RATE_LIMIT_BLOCK_MS - 100);
  });

  it('requeue delay: 60 s after MiniMax itself said 1002, else the limiter wait', () => {
    expect(requeueDelaySeconds(1234, true)).toBe(60);
    expect(requeueDelaySeconds(1234, false)).toBe(2);
    expect(requeueDelaySeconds(10, false)).toBe(1);
  });
});

function fakeDoState() {
  const store = new Map<string, unknown>();
  return { storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, v) } };
}

describe('TtsLimiter Durable Object', () => {
  it('grants, counts per minute, and backs everyone off after a 1002', async () => {
    const dobj = new TtsLimiter(fakeDoState() as never, { MINIMAX_RPM: '55' } as Env);
    const first = await dobj.acquire('interactive');
    expect(first.granted).toBe(true);
    await dobj.report('ok');
    await dobj.report('rate_limited');
    expect((await dobj.acquire('interactive')).granted).toBe(false);
    const snap = await dobj.snapshot();
    expect(snap.rpm).toBe(55);
    expect(snap.blocked_until).not.toBeNull();
    const total = snap.minutes.reduce((n, m) => ({ i: n.i + m.interactive, ok: n.ok + m.ok, rl: n.rl + m.rateLimited, d: n.d + m.denied }), { i: 0, ok: 0, rl: 0, d: 0 });
    expect(total).toEqual({ i: 1, ok: 1, rl: 1, d: 1 });
  });

  it('one backfill pump at a time (lease by token)', async () => {
    const dobj = new TtsLimiter(fakeDoState() as never, {} as Env);
    expect(await dobj.claimPump('a', 60_000)).toBe(true);
    expect(await dobj.claimPump('b', 60_000)).toBe(false);
    expect(await dobj.claimPump('a', 60_000)).toBe(true);
    await dobj.releasePump('a');
    expect(await dobj.claimPump('b', 60_000)).toBe(true);
  });

  it('night mode raises the batch share', async () => {
    const dobj = new TtsLimiter(fakeDoState() as never, {} as Env);
    expect((await dobj.snapshot()).batch_share).toBe(0.6);
    await dobj.setNight(Date.now() + 3600_000);
    expect((await dobj.snapshot()).batch_share).toBe(0.9);
  });
});

describe('nightly cron: London midnight across DST', () => {
  it.each([
    // [UTC time, London hour, acts?]
    ['2026-07-14T23:00:00Z', 0, true], // BST: 23:00 UTC = 00:00 London
    ['2026-07-15T00:00:00Z', 1, false],
    ['2026-01-14T23:00:00Z', 23, false], // GMT
    ['2026-01-15T00:00:00Z', 0, true],
    ['2026-03-28T23:00:00Z', 23, false], // the night BST starts (29 Mar, 01:00 UTC): still GMT at midnight
    ['2026-03-29T00:00:00Z', 0, true],
    ['2026-03-29T23:00:00Z', 0, true], // first BST night
    ['2026-10-24T23:00:00Z', 0, true], // last BST night (GMT from 25 Oct 01:00 UTC)
    ['2026-10-25T00:00:00Z', 1, false],
    ['2026-10-25T23:00:00Z', 23, false],
    ['2026-10-26T00:00:00Z', 0, true],
    ['2026-07-14T23:09:00Z', 0, true], // a late cron still counts
  ])('%s → London %i:00, acts: %s', (iso, hour, acts) => {
    const d = new Date(iso as string);
    expect(londonHour(d)).toBe(hour);
    expect(isLondonMidnight(d)).toBe(acts);
  });

  it('exactly one of the two nightly crons acts on any date', () => {
    for (let day = 0; day < 366; day++) {
      const base = Date.UTC(2026, 0, 1) + day * 86_400_000;
      const at23 = isLondonMidnight(new Date(base - 3600_000)); // 23:00 UTC the evening before
      const at00 = isLondonMidnight(new Date(base));
      expect(Number(at23) + Number(at00)).toBe(1);
    }
  });

  it('starts night mode + the pump only at London midnight; the hourly cron nudges the pump', async () => {
    const sent: unknown[] = [];
    const nights: number[] = [];
    const env = {
      MINIMAX_API_KEY: 'k',
      TTS_QUEUE: { send: async (b: unknown) => void sent.push(b) },
      TTS_LIMITER: { idFromName: () => 'x', get: () => ({ setNight: async (u: number) => void nights.push(u) }) },
    } as unknown as Env;
    expect(await runAudioCron(env, '0 23 * * *', new Date('2026-01-14T23:00:00Z'))).toBe('not_london_midnight');
    expect(sent).toHaveLength(0);
    expect(await runAudioCron(env, '0 0 * * *', new Date('2026-01-15T00:00:00Z'))).toBe('night_started');
    expect(nights).toHaveLength(1);
    expect(sent).toMatchObject([{ kind: 'pump', night: true }]);
    expect(await runAudioCron(env, '37 * * * *', new Date())).toBe('pump_nudged');
    expect(await runAudioCron(env, '17 3 * * *', new Date())).toBe('not_audio');
  });
});
