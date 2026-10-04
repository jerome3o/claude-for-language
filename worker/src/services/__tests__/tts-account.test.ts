/**
 * MiniMax ACCOUNT problems (docs/AUDIO.md "Account problems"): a 2053 (no
 * credit) pauses every call without burning a clip's attempts; the probe after
 * the pause either clears it — and retries the clips that failed only for the
 * account — or doubles the pause; the admin retry; the pay-as-you-go cap / ramp.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCOUNT_PAUSE_MIN_MS,
  ACCOUNT_PROBE_TIMEOUT_MS,
  accountErrorCode,
  accountGate,
  accountPauseMs,
  markProbe,
  noteAccountError,
  noteCallOutcome,
  resetAccountFailures,
} from '../tts/account';
import { adaptiveBounds, initialAdaptive, noteRequest, rollAdaptive } from '../tts/bucket';
import { TtsLimiter } from '../../durable/tts-limiter';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { ensureClip, type TtsFn } from '../tts/clips';
import { handleClipMessage } from '../tts/queue';
import type { Env } from '../../types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIN = 60_000;
const T0 = Date.parse('2026-10-04T12:00:00Z');

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function fakeDoState() {
  const store = new Map<string, unknown>();
  return {
    store,
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => store.delete(k),
    },
  };
}

/** A TtsLimiter whose ntfy pings are recorded instead of sent. */
class TestLimiter extends TtsLimiter {
  pings: string[] = [];
  protected override async notify(event: 'account_problem' | 'account_cleared'): Promise<void> {
    this.pings.push(event);
  }
}

describe('account errors: pure rules', () => {
  it('pause ladder 5 → 10 → 20 → 40 → 60 → 60 min', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => accountPauseMs(n) / MIN)).toEqual([5, 10, 20, 40, 60, 60]);
  });

  it('which answers are account problems', () => {
    expect(accountErrorCode({ code: 2053 })).toBe(2053);
    expect(accountErrorCode({ code: 1008 })).toBe(1008);
    expect(accountErrorCode({ code: 1004 })).toBe(1004);
    expect(accountErrorCode({ code: 2049 })).toBe(2049);
    expect(accountErrorCode({ httpStatus: 401 })).toBe('http 401');
    expect(accountErrorCode({ code: 1002 })).toBeNull(); // rate limit
    expect(accountErrorCode({ code: 2013 })).toBeNull(); // bad text
    expect(accountErrorCode({ httpStatus: 500 })).toBeNull();
  });

  it('a 2053 pauses everyone; stragglers in flight do not lengthen it; a failed probe doubles it', () => {
    const first = noteAccountError(null, 2053, 'insufficient credit', T0);
    expect(first.started).toBe(true);
    expect(first.problem.pausedUntil).toBe(T0 + 5 * MIN);
    expect(accountGate(first.problem, T0 + MIN)).toEqual({ allowed: false, retryAfterMs: 4 * MIN });

    const straggler = noteAccountError(first.problem, 2053, 'insufficient credit', T0 + 1000);
    expect(straggler.started).toBe(false);
    expect(straggler.problem.streak).toBe(1);
    expect(straggler.problem.pausedUntil).toBe(T0 + 5 * MIN);

    // After the pause: ONE probe, the rest wait for it.
    const gate = accountGate(straggler.problem, T0 + 5 * MIN);
    expect(gate).toEqual({ allowed: true, probe: true });
    const probing = markProbe(straggler.problem, T0 + 5 * MIN);
    expect(accountGate(probing, T0 + 5 * MIN + 10)).toMatchObject({ allowed: false });
    // A probe that never reports frees the gate.
    expect(accountGate(probing, T0 + 5 * MIN + ACCOUNT_PROBE_TIMEOUT_MS)).toEqual({ allowed: true, probe: true });

    const failedProbe = noteAccountError(probing, 2053, 'insufficient credit', T0 + 5 * MIN + 500);
    expect(failedProbe.started).toBe(false);
    expect(failedProbe.problem.streak).toBe(2);
    expect(failedProbe.problem.pausedUntil).toBe(T0 + 5 * MIN + 500 + 10 * MIN);
    expect(failedProbe.problem.since).toBe(T0);
  });

  it('a clip or MiniMax rate limit clears it; a network blip only reopens the probe gate', () => {
    const p = markProbe(noteAccountError(null, 2053, 'x', T0).problem, T0 + 5 * MIN);
    expect(noteCallOutcome(p, 'ok')).toEqual({ problem: null, cleared: true });
    expect(noteCallOutcome(p, 'rate_limited')).toEqual({ problem: null, cleared: true });
    const blip = noteCallOutcome(p, 'network');
    expect(blip.cleared).toBe(false);
    expect(blip.problem?.probeAt).toBeNull();
    expect(noteCallOutcome(null, 'ok')).toEqual({ problem: null, cleared: false });
  });
});

describe('a 2053 never burns a clip’s attempts', () => {
  let db: SqliteD1;
  let sent: Array<{ body: unknown; opts?: { delaySeconds?: number } }>;
  let env: Env;

  beforeEach(async () => {
    db = await createSqliteD1();
    exec(db, "INSERT INTO users (id, email, name) VALUES ('u', 'u@example.com', 'U')");
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d', 'u', 'D')");
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd', '你好', 'nǐ hǎo', 'hello')");
    sent = [];
    env = {
      DB: db,
      MINIMAX_API_KEY: 'k',
      TTS_QUEUE: { send: async (body: unknown, opts?: { delaySeconds?: number }) => void sent.push({ body, opts }) },
      AUDIO_BUCKET: { head: async () => null, delete: async () => {}, put: async () => {} },
    } as unknown as Env;
  });

  it('ensureClip: an account error is a wait (no tts_clip_failures row), a real failure is recorded', async () => {
    const noCredit: TtsFn = async () => ({
      ok: false, permanent: false, rateLimited: true, account: 2053,
      reason: 'base_resp 2053 insufficient credit', retryAfterMs: ACCOUNT_PAUSE_MIN_MS,
    });
    const r = await ensureClip(env, { kind: 'word', id: 'n1' }, { priority: 'batch', tts: noCredit });
    expect(r).toEqual({ status: 'rate_limited', retryAfterMs: ACCOUNT_PAUSE_MIN_MS, minimax: false });
    expect(db.rows('SELECT * FROM tts_clip_failures')).toEqual([]);
  });

  it('the queue requeues it after the pause (capped at 5 min), never as a failure', async () => {
    const paused: TtsFn = async () => ({ ok: false, permanent: false, rateLimited: true, account: 2053, reason: 'account paused', retryAfterMs: 40 * MIN });
    await handleClipMessage(env, { kind: 'clip', target: { kind: 'word', id: 'n1' }, priority: 'batch' }, paused);
    expect(sent[0]).toMatchObject({ body: { attempt: 1 }, opts: { delaySeconds: 300 } });
    expect(db.rows('SELECT * FROM tts_clip_failures')).toEqual([]);
  });

  it('resetAccountFailures / the retry tool: account rows (or one code) are due now with attempts 0; others untouched', async () => {
    const tomorrow = '2026-10-05T12:50:00.000Z';
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, last_error, next_attempt_at) VALUES ('word', 'a', 4, 'base_resp 2053 insufficient credit', ?)", tomorrow);
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, last_error, next_attempt_at) VALUES ('word', 'b', 1, 'http 401', ?)", tomorrow);
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, last_error, next_attempt_at) VALUES ('word', 'c', 2, 'base_resp 2013 invalid params', ?)", tomorrow);

    expect(await resetAccountFailures(db, { code: 2053, now: T0 })).toBe(1);
    const after = db.rows<{ target_id: string; attempts: number; next_attempt_at: string }>('SELECT target_id, attempts, next_attempt_at FROM tts_clip_failures ORDER BY target_id');
    expect(after).toEqual([
      { target_id: 'a', attempts: 0, next_attempt_at: new Date(T0).toISOString() },
      { target_id: 'b', attempts: 1, next_attempt_at: tomorrow },
      { target_id: 'c', attempts: 2, next_attempt_at: tomorrow },
    ]);
    expect(await resetAccountFailures(db, { now: T0 })).toBe(2); // every account error: a (again) + b
    expect(db.rows<{ attempts: number }>("SELECT attempts FROM tts_clip_failures WHERE target_id = 'c'")[0].attempts).toBe(2);
  });
});

describe('TtsLimiter: pause, probe, recover', () => {
  afterEach(() => vi.useRealTimers());

  it('2053 → everyone paused (one ntfy) → the probe works → cleared, account clips retried, pump started (one ntfy)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const db = await createSqliteD1();
    exec(db, "INSERT INTO tts_clip_failures (kind, target_id, attempts, last_error, next_attempt_at) VALUES ('word', 'n1', 4, 'base_resp 2053 insufficient credit', '2026-10-05T12:50:00.000Z')");
    const sent: unknown[] = [];
    const state = fakeDoState();
    const lim = new TestLimiter(state as never, {
      MINIMAX_RPM: '55',
      DB: db,
      TTS_QUEUE: { send: async (body: unknown) => void sent.push(body) },
    } as unknown as Env);

    expect((await lim.acquire('batch')).granted).toBe(true);
    const r = await lim.report('account_error', { code: 2053, message: 'base_resp 2053 insufficient credit' });
    expect(r.pausedForMs).toBe(5 * MIN);
    await lim.report('account_error', { code: 2053, message: 'base_resp 2053 insufficient credit' }); // a straggler
    expect(lim.pings).toEqual(['account_problem']);

    const denied = await lim.acquire('interactive');
    expect(denied).toMatchObject({ granted: false, account: 2053 });
    expect(denied.retryAfterMs).toBe(5 * MIN);
    const snap = await lim.snapshot();
    expect(snap.account_problem).toMatchObject({ code: 2053, streak: 1 });
    // Denials during a pause are not demand: the learned rate does not climb.
    const rpmBefore = snap.learned_rpm;
    vi.setSystemTime(T0 + 3 * MIN);
    await lim.acquire('batch');
    expect((await lim.snapshot()).learned_rpm).toBe(rpmBefore);

    // Pause over: one probe goes, the next caller waits for it.
    vi.setSystemTime(T0 + 5 * MIN + 1);
    expect((await lim.acquire('batch')).granted).toBe(true);
    expect(await lim.acquire('interactive')).toMatchObject({ granted: false, account: 2053 });
    await lim.report('ok');

    expect((await lim.snapshot()).account_problem).toBeNull();
    expect(state.store.has('account')).toBe(false);
    expect(lim.pings).toEqual(['account_problem', 'account_cleared']);
    expect(db.rows('SELECT attempts, next_attempt_at FROM tts_clip_failures')).toEqual([{ attempts: 0, next_attempt_at: new Date(T0 + 5 * MIN + 1).toISOString() }]);
    expect(sent).toMatchObject([{ kind: 'pump' }]);
    vi.setSystemTime(T0 + 6 * MIN); // the probe took the bucket's only token (burst 1 at 8/min)
    expect((await lim.acquire('interactive')).granted).toBe(true);
  });

  it('a failed probe doubles the pause; the pause survives a restart; probeAccountNow lets the next call probe', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const state = fakeDoState();
    const lim = new TestLimiter(state as never, { MINIMAX_RPM: '55' } as Env);
    await lim.report('account_error', { code: 2053, message: 'x' });
    vi.setSystemTime(T0 + 5 * MIN);
    expect((await lim.acquire('batch')).granted).toBe(true); // the probe
    expect((await lim.report('account_error', { code: 2053, message: 'x' })).pausedForMs).toBe(10 * MIN);
    expect(lim.pings).toEqual(['account_problem']);

    const restarted = new TestLimiter(state as never, { MINIMAX_RPM: '55' } as Env);
    expect(await restarted.acquire('interactive')).toMatchObject({ granted: false, account: 2053 });
    expect(await restarted.probeAccountNow()).toBe(true);
    expect((await restarted.acquire('interactive')).granted).toBe(true);
  });
});

describe('pay-as-you-go: cap 55, a faster ramp', () => {
  it('wrangler.toml caps the learned rate at 55 (under the 60/min plan)', () => {
    const toml = readFileSync(fileURLToPath(new URL('../../../wrangler.toml', import.meta.url)), 'utf8');
    const rpm = /^MINIMAX_RPM = "(\d+)"/m.exec(toml)?.[1];
    const max = /^MINIMAX_RPM_MAX = "(\d+)"/m.exec(toml)?.[1];
    expect(adaptiveBounds(rpm, max)).toEqual({ floor: 2, cap: 55 });
  });

  it('from the Starter rate (9) to 55 in 8 clean busy minutes, never past the cap', () => {
    const b = adaptiveBounds('55', '60');
    let s = initialAdaptive(b, 0, { rpm: 9, history: [] });
    const seen = [s.rpm];
    for (let m = 0; m < 10; m++) {
      s = noteRequest(s, b, m * MIN + 1_000, true);
      s = rollAdaptive(s, b, (m + 1) * MIN);
      seen.push(s.rpm);
    }
    expect(seen).toEqual([9, 12, 15, 19, 24, 30, 38, 48, 55, 55, 55]);
  });
});
