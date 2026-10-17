/**
 * Queue churn (docs/AUDIO.md "Queue churn"): a simulation of tts-queue + the
 * limiter's real bucket (services/tts/bucket.ts) on a virtual clock.
 *
 * 16 Oct 2026: tts-queue processed ~250k messages and the limiter took ~525k calls
 * to make ~19k clips — every refused batch clip came back 30–60 s later, up to 60
 * times, and asked MiniMax's (account-paused) limiter first every time. The new
 * rules: a batch clip the backfill would find is left to the pump; any other
 * refused clip books its slot and comes back exactly then; pump workers book
 * their slot and sleep; a paused provider is skipped without a call.
 * Target: ~1–2 messages per clip made.
 */
import { describe, expect, it } from 'vitest';
import { initialState, limiterConfig, tryAcquire, type AcquireOptions, type BucketState } from '../tts/bucket';

const CLIP_MS = 2_000;

interface Stats {
  messages: number;
  limiterCalls: number;
  made: number;
  finishedAt: number;
}

class Sim {
  t = 0;
  private events: Array<{ t: number; seq: number; run: () => void }> = [];
  private seq = 0;
  at(t: number, run: () => void) {
    this.events.push({ t, seq: this.seq++, run });
  }
  runUntil(end: number) {
    while (this.events.length) {
      this.events.sort((a, b) => a.t - b.t || a.seq - b.seq);
      const e = this.events.shift()!;
      if (e.t > end) break;
      this.t = e.t;
      e.run();
    }
  }
}

function makeLimiter(rpm: number, stats: Stats) {
  const cfg = limiterConfig(rpm);
  let state: BucketState = initialState(cfg, 0);
  return (t: number, opts: AcquireOptions = {}) => {
    stats.limiterCalls++;
    const r = tryAcquire(state, cfg, 'batch', t, opts);
    state = r.state;
    return r;
  };
}

/** `n` clip messages land at once (a sentence-set import), Azure at 15/min, MiniMax account-paused. */
function scenario(mode: 'old' | 'new', opts: { n: number; findable: boolean; rpm?: number; hours?: number }) {
  const stats: Stats = { messages: 0, limiterCalls: 0, made: 0, finishedAt: 0 };
  const sim = new Sim();
  const acquire = makeLimiter(opts.rpm ?? 15, stats);
  const made = new Set<number>();
  const busy = new Set<number>();
  let pumpRunning = false;
  let jitter = 0;
  const finish = (id: number) => {
    made.add(id);
    stats.made++;
    stats.finishedAt = sim.t;
  };

  // ---- the queue messages ----
  const clipMessage = (id: number, attempt: number, ticket: number | null) => {
    stats.messages++;
    if (made.has(id)) return; // 'current': a D1 read, no limiter call
    if (mode === 'old') {
      stats.limiterCalls++; // MiniMax's paused limiter asked first, every time
      const r = acquire(sim.t);
      if (r.granted) return finish(id);
      if (attempt >= 60) return; // gave up: left to the backfill
      jitter = (jitter + 7) % 30;
      sim.at(sim.t + (30 + jitter) * 1000, () => clipMessage(id, attempt + 1, null));
      return;
    }
    const r = acquire(sim.t, { book: !opts.findable, ticket });
    if (r.granted) return finish(id);
    if (opts.findable) return startPump(); // left to the backfill; the pump is nudged
    sim.at(sim.t + Math.ceil(r.retryAfterMs / 1000) * 1000, () => clipMessage(id, attempt + 1, r.ticket ?? null));
  };

  // ---- the backfill pump: picks 9, three workers, ≤ 40 s a delivery ----
  const startPump = () => {
    if (pumpRunning) return;
    pumpRunning = true;
    sim.at(sim.t, pumpTick);
  };
  const pumpTick = () => {
    stats.messages++;
    const picks: number[] = [];
    for (let id = 0; id < opts.n && picks.length < 9; id++) if (!made.has(id) && !busy.has(id)) picks.push(id);
    if (picks.length === 0) {
      pumpRunning = false;
      return;
    }
    const started = sim.t;
    let next = 0;
    let running = 0;
    let stopDelay: number | null = null;
    const done = () => {
      if (--running > 0) return;
      const delay = stopDelay ?? 0;
      sim.at(sim.t + delay * 1000, pumpTick);
    };
    const work = () => {
      if (stopDelay !== null || next >= picks.length || sim.t - started >= 40_000) return done();
      const id = picks[next++];
      busy.add(id);
      const deadline = sim.t + 20_000;
      const attemptSlot = (ticket: number | null) => {
        const left = deadline - sim.t;
        const r = mode === 'new' ? acquire(sim.t, { book: left > 0, bookWithinMs: left, ticket }) : acquire(sim.t);
        if (mode === 'old') stats.limiterCalls++; // the paused MiniMax limiter first
        if (r.granted) {
          sim.at(sim.t + CLIP_MS, () => {
            busy.delete(id);
            finish(id);
            work();
          });
          return;
        }
        if (sim.t + r.retryAfterMs > deadline) {
          busy.delete(id);
          stopDelay = Math.min(300, Math.ceil(r.retryAfterMs / 1000));
          return done();
        }
        sim.at(sim.t + r.retryAfterMs, () => attemptSlot(r.ticket ?? ticket));
      };
      attemptSlot(null);
    };
    for (let w = 0; w < Math.min(3, picks.length); w++) {
      running++;
      work();
    }
  };

  for (let id = 0; id < opts.n; id++) sim.at(id * 10, () => clipMessage(id, 1, null));
  if (mode === 'old' && opts.findable) sim.at(0, startPump); // the hourly cron nudge
  sim.runUntil((opts.hours ?? 6) * 3600_000);
  return { ...stats, perClip: stats.messages / Math.max(1, stats.made), callsPerClip: stats.limiterCalls / Math.max(1, stats.made), minutes: stats.finishedAt / 60_000 };
}

describe('tts-queue churn (simulation, 15/min = 9 batch clips a minute)', () => {
  it('600 missing clips at once: ~1 message per clip (was ~13), the limiter at full pace', () => {
    const before = scenario('old', { n: 600, findable: true });
    const after = scenario('new', { n: 600, findable: true });
    // The old loop: refused clips cycling every 30–60 s.
    expect(before.perClip).toBeGreaterThan(8);
    expect(after.made).toBe(600);
    expect(after.perClip).toBeLessThan(1.5);
    // one refused call per original message + booked slot and claim per pump clip
    expect(after.callsPerClip).toBeLessThan(3.2);
    // Same throughput: 9 batch clips a minute → ~67 minutes (+ slack).
    expect(after.minutes).toBeLessThan(75);
    // eslint-disable-next-line no-console
    console.log('[churn sim] missing clips', JSON.stringify({ before, after }));
  });

  it('300 forced remakes (the backfill would not find them): booked slots, ≤ 2 messages per clip', () => {
    const after = scenario('new', { n: 300, findable: false });
    expect(after.made).toBe(300);
    expect(after.perClip).toBeLessThanOrEqual(2.05);
    expect(after.callsPerClip).toBeLessThanOrEqual(2.05);
    expect(after.minutes).toBeLessThan(40);
    const before = scenario('old', { n: 300, findable: false });
    expect(before.perClip).toBeGreaterThan(8);
    // eslint-disable-next-line no-console
    console.log('[churn sim] forced clips', JSON.stringify({ before, after }));
  });
});

describe('limiter bookings (batch line)', () => {
  const cfg = limiterConfig(15); // 9 batch tokens a minute → one every ~6.7 s
  it('a refused caller books the next free slot; the line is FIFO and an unbooked caller waits behind it', () => {
    let s: BucketState = initialState(cfg, 0);
    const first = tryAcquire(s, cfg, 'batch', 0);
    s = first.state;
    expect(first.granted).toBe(true);
    const a = tryAcquire(s, cfg, 'batch', 100, { book: true });
    s = a.state;
    const b = tryAcquire(s, cfg, 'batch', 200, { book: true });
    s = b.state;
    expect(a.granted).toBe(false);
    expect(a.ticket).toBeGreaterThan(6_000);
    expect(b.ticket! - a.ticket!).toBeGreaterThanOrEqual(6_666);
    // someone without a booking, when a's slot comes: told to wait behind the line
    const late = tryAcquire(s, cfg, 'batch', a.ticket!);
    s = late.state;
    expect(late.granted).toBe(false);
    expect(late.ticket).toBeUndefined();
    expect(late.retryAfterMs).toBeGreaterThan(b.ticket! - a.ticket!);
    // a comes back with its ticket (late, as a queue delivery is) and gets it
    const aBack = tryAcquire(s, cfg, 'batch', a.ticket! + 1_500, { ticket: a.ticket });
    s = aBack.state;
    expect(aBack.granted).toBe(true);
    // b too, at its slot; the line is empty again
    const bBack = tryAcquire(s, cfg, 'batch', b.ticket! + 500, { ticket: b.ticket });
    s = bBack.state;
    expect(bBack.granted).toBe(true);
    expect(s.bookings).toEqual([]);
  });

  it('an in-process waiter books only within its deadline; an unclaimed booking stops holding others back, then is dropped', () => {
    let s: BucketState = initialState(cfg, 0);
    s = tryAcquire(s, cfg, 'batch', 0).state;
    const far = tryAcquire(s, cfg, 'batch', 10, { book: true, bookWithinMs: 1_000 });
    expect(far.ticket).toBeUndefined();
    const near = tryAcquire(far.state, cfg, 'batch', 10, { book: true, bookWithinMs: 20_000 });
    expect(near.ticket).toBeDefined();
    s = near.state;
    // its owner never comes: 2 s after the slot anyone may take the token…
    const other = tryAcquire(s, cfg, 'batch', near.ticket! + 2_500);
    expect(other.granted).toBe(true);
    // …and 30 s after it the booking is gone
    const later = tryAcquire(other.state, cfg, 'batch', near.ticket! + 31_000);
    expect(later.state.bookings ?? []).toEqual([]);
  });

  it('interactive callers ignore the line', () => {
    let s: BucketState = initialState(cfg, 0);
    s = tryAcquire(s, cfg, 'batch', 0).state;
    s = tryAcquire(s, cfg, 'batch', 10, { book: true }).state;
    expect(tryAcquire(s, cfg, 'interactive', 4_100).granted).toBe(true);
  });
});
