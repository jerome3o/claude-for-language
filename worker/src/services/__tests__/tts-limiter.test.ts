/**
 * The MiniMax rate limiter (docs/AUDIO.md "Rate limit"): token bucket under the
 * RPM, interactive before batch, a 1002 empties the buckets; the Durable Object
 * that holds it; the nightly cron's London-midnight check across DST.
 */
import { describe, it, expect } from 'vitest';
import {
  ADAPTIVE_START_RPM,
  adaptiveBounds,
  initialAdaptive,
  noteRateLimited,
  noteRequest,
  rollAdaptive,
  type AdaptiveState,
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
  return { storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, v), delete: async (k: string) => store.delete(k) } };
}

describe('adaptive rate (AIMD)', () => {
  const MIN = 60_000;
  const b = adaptiveBounds(undefined, undefined);

  /** One busy minute: somebody was refused a slot; optionally MiniMax said 1002. */
  function busyMinute(s: AdaptiveState, minute: number, rateLimited = false): AdaptiveState {
    let st = noteRequest(s, b, minute * MIN + 1_000, true);
    if (rateLimited) st = noteRateLimited(st, b, minute * MIN + 30_000);
    return st;
  }

  it('bounds: floor 2, cap MINIMAX_RPM_MAX (60), MINIMAX_RPM is a hard cap when set', () => {
    expect(adaptiveBounds(undefined, undefined)).toEqual({ floor: 2, cap: 60 });
    expect(adaptiveBounds('9', '60')).toEqual({ floor: 2, cap: 9 });
    expect(adaptiveBounds('100', '60')).toEqual({ floor: 2, cap: 60 });
    expect(adaptiveBounds(undefined, '30')).toEqual({ floor: 2, cap: 30 });
    expect(adaptiveBounds('abc', '')).toEqual({ floor: 2, cap: 60 });
  });

  it('a first run starts at 8', () => {
    const s = initialAdaptive(b, 0, null);
    expect(s.rpm).toBe(ADAPTIVE_START_RPM);
    expect(s.history.at(-1)?.reason).toBe('start');
  });

  it('ramps ×1.25 (at least +2) per full minute with demand and no 1002, up to the cap', () => {
    let s = initialAdaptive(b, 0, null);
    for (let m = 0; m < 3; m++) s = busyMinute(s, m);
    s = rollAdaptive(s, b, 3 * MIN);
    expect(s.rpm).toBe(17); // 8 → 10 → 13 → 17
    for (let m = 3; m < 60; m++) s = busyMinute(s, m);
    s = rollAdaptive(s, b, 60 * MIN);
    expect(s.rpm).toBe(60);
  });

  it('no demand → no ramp (an idle minute proves nothing), and a long gap earns at most one step', () => {
    let s = initialAdaptive(b, 0, null);
    s = noteRequest(s, b, 1_000, false); // granted, never refused
    s = rollAdaptive(s, b, 5 * MIN);
    expect(s.rpm).toBe(8);
    s = noteRequest(s, b, 5 * MIN + 1_000, true);
    s = rollAdaptive(s, b, 50 * MIN);
    expect(s.rpm).toBe(10);
  });

  it('halves on a 1002 / 429 and the minute it happened in earns nothing', () => {
    let s = initialAdaptive(b, 0, { rpm: 20, history: [] });
    s = busyMinute(s, 0, true);
    expect(s.rpm).toBe(10);
    expect(s.lastRateLimitedAt).toBe(30_000);
    s = noteRequest(s, b, 60_000 + 1_000, true); // still inside the window opened by the 1002
    s = rollAdaptive(s, b, 90_000 + 1);
    expect(s.rpm).toBe(10);
    s = noteRequest(s, b, 100_000, true);
    s = rollAdaptive(s, b, 150_000 + 1);
    expect(s.rpm).toBe(13);
  });

  it('never below the floor', () => {
    let s = initialAdaptive(b, 0, { rpm: 3, history: [] });
    for (let i = 0; i < 5; i++) s = noteRateLimited(s, b, i * 1000);
    expect(s.rpm).toBe(2);
  });

  it('on Starter (10/min) with no hard cap it settles around the plan: never more than one 1002 per few minutes', () => {
    // MiniMax refuses above 10/min: a minute run at > 10 ends in a 1002.
    let s = initialAdaptive(b, 0, null);
    let limited = 0;
    for (let m = 0; m < 60; m++) {
      s = rollAdaptive(s, b, m * MIN);
      const over = s.rpm > 10;
      s = busyMinute(s, m, over);
      if (over) limited++;
    }
    expect(s.rpm).toBeLessThanOrEqual(12);
    expect(limited).toBeLessThanOrEqual(15);
  });

  it('a restart keeps the learned rate and history; a lowered cap clamps it', () => {
    let s = initialAdaptive(b, 0, null);
    for (let m = 0; m < 4; m++) s = busyMinute(s, m);
    s = rollAdaptive(s, b, 4 * MIN);
    const saved = JSON.parse(JSON.stringify(s)) as AdaptiveState;
    const again = initialAdaptive(b, 10 * MIN, saved);
    expect(again.rpm).toBe(22); // 8 → 10 → 13 → 17 → 22
    expect(again.history.length).toBe(s.history.length);
    const capped = initialAdaptive(adaptiveBounds('9', '60'), 10 * MIN, saved);
    expect(capped.rpm).toBe(9);
    expect(capped.history.at(-1)?.reason).toBe('bounds');
  });
});

describe('9 RPM: the backfill never starves a tap', () => {
  it('batch polling every 100 ms; a tap that waits gets the next token within one token interval', () => {
    const cfg = limiterConfig(9);
    let state = initialState(cfg, 0);
    let batchGrants = 0;
    let tapAt: number | null = null;
    let tapGranted: number | null = null;
    let tapRetryAt = 0;
    for (let t = 0; t < 10 * 60_000; t += 100) {
      // A tap at 5 min, which retries when told to.
      if (t === 5 * 60_000) tapAt = t;
      if (tapAt !== null && tapGranted === null && t >= tapRetryAt) {
        const r = tryAcquire(state, cfg, 'interactive', t);
        state = r.state;
        if (r.granted) tapGranted = t;
        else tapRetryAt = t + r.retryAfterMs;
      }
      const r = tryAcquire(state, cfg, 'batch', t);
      state = r.state;
      if (r.granted) batchGrants++;
    }
    expect(tapGranted).not.toBeNull();
    expect(tapGranted! - tapAt!).toBeLessThanOrEqual(Math.ceil(60_000 / 9) + 200);
    // …and the backfill still drains at about its share.
    expect(batchGrants).toBeGreaterThanOrEqual(Math.floor(9 * 0.6 * 10) - 3);
  });
});

describe('TtsLimiter Durable Object', () => {
  it('persists the learned rate across a restart', async () => {
    const doState = fakeDoState();
    const one = new TtsLimiter(doState as never, { MINIMAX_RPM: '9' } as Env);
    expect((await one.snapshot()).learned_rpm).toBe(8);
    await one.report('rate_limited');
    const two = new TtsLimiter(doState as never, { MINIMAX_RPM: '9' } as Env);
    const snap = await two.snapshot();
    expect(snap.learned_rpm).toBe(4);
    expect(snap.rpm_cap).toBe(9);
    expect(snap.last_rate_limited_at).not.toBeNull();
    expect(snap.rpm_history.map((h) => h.reason)).toEqual(['start', 'rate_limited']);
  });

  it('grants, counts per minute, and backs everyone off after a 1002', async () => {
    const dobj = new TtsLimiter(fakeDoState() as never, { MINIMAX_RPM: '55' } as Env);
    await dobj.snapshot();
    const first = await dobj.acquire('interactive');
    expect(first.granted).toBe(true);
    await dobj.report('ok');
    await dobj.report('rate_limited');
    expect((await dobj.acquire('interactive')).granted).toBe(false);
    const snap = await dobj.snapshot();
    // First run starts at 8 and halves on the 1002.
    expect(snap.learned_rpm).toBe(4);
    expect(snap.rpm).toBe(4);
    expect(snap.rpm_cap).toBe(55);
    expect(snap.last_rate_limited_at).not.toBeNull();
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
