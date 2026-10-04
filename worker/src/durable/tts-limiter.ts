/**
 * TtsLimiter — ONE Durable Object (idFromName('minimax')) that every MiniMax
 * call asks for a slot first: stored clips, conversation lines, chat
 * read-aloud, voice samples (docs/AUDIO.md "Rate limit"). The bucket
 * arithmetic is pure (services/tts/bucket.ts); this object holds the state,
 * counts what happened per minute (the backfill status's throughput), knows
 * whether it is night (the nightly backfill may use more of the rate) and
 * holds the backfill pump's lease so only one pump runs.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  adaptiveBounds,
  initialAdaptive,
  noteRateLimited,
  noteRequest,
  rollAdaptive,
  initialState,
  limiterConfig,
  penalize,
  refill,
  tryAcquire,
  type AdaptiveState,
  type BucketState,
  type RateChange,
  type TtsPriority,
} from '../services/tts/bucket';
import {
  accountGate,
  markProbe,
  noteAccountError,
  noteCallOutcome,
  resetAccountFailures,
  type AccountProblem,
} from '../services/tts/account';
import { notifyTtsAccountCleared, notifyTtsAccountProblem } from '../services/notifications';
import { startPump } from '../services/tts/queue';
import type { TtsReport } from '../services/tts/limiter';

export interface MinuteStats {
  /** Epoch minute. */
  minute: number;
  interactive: number;
  batch: number;
  denied: number;
  rateLimited: number;
  ok: number;
  failed: number;
}

export interface LimiterSnapshot {
  /** The rate in force = the learned rate (AIMD). */
  rpm: number;
  learned_rpm: number;
  rpm_floor: number;
  rpm_cap: number;
  last_rate_limited_at: number | null;
  /** Recent changes of the learned rate, newest last. */
  rpm_history: RateChange[];
  burst: number;
  batch_share: number;
  night_until: number | null;
  tokens: number;
  batch_tokens: number;
  blocked_until: number | null;
  pump_lease_until: number | null;
  /** Last 60 minutes, oldest first (minutes with nothing are left out). */
  minutes: MinuteStats[];
  /** No credit / bad key: every call paused (services/tts/account.ts). Null = fine. */
  account_problem: AccountProblem | null;
}

const LOG_EVERY_MS = 60_000;
const KEEP_MINUTES = 60;

export class TtsLimiter extends DurableObject<Env> {
  private state: BucketState | null = null;
  private nightUntil = 0;
  private pumpLeaseUntil = 0;
  private pumpToken = '';
  private minutes: MinuteStats[] = [];
  private adaptive: AdaptiveState | null = null;
  private account: AccountProblem | null = null;
  private loaded = false;
  private lastLog = 0;

  private async load(): Promise<void> {
    if (this.loaded) return;
    const storage = (this.ctx as DurableObjectState).storage;
    const saved = await storage.get<{ nightUntil?: number; pumpLeaseUntil?: number; pumpToken?: string; minutes?: MinuteStats[] }>('meta');
    this.nightUntil = saved?.nightUntil ?? 0;
    this.pumpLeaseUntil = saved?.pumpLeaseUntil ?? 0;
    this.pumpToken = saved?.pumpToken ?? '';
    this.minutes = saved?.minutes ?? [];
    const learned = await storage.get<AdaptiveState>('adaptive');
    this.adaptive = initialAdaptive(this.bounds(), Date.now(), learned);
    this.account = (await storage.get<AccountProblem>('account')) ?? null;
    this.loaded = true;
  }

  private saveAccount(): void {
    const storage = (this.ctx as DurableObjectState).storage;
    void (this.account ? storage.put('account', this.account) : storage.delete('account'));
  }

  /** ntfy (NTFY_TOPIC) — a method so tests can see it. */
  protected async notify(event: 'account_problem' | 'account_cleared', info: { code: number | string; message?: string; minutes?: number; reset?: number }): Promise<void> {
    if (!this.env.NTFY_TOPIC) return;
    if (event === 'account_problem') await notifyTtsAccountProblem(this.env.NTFY_TOPIC, { code: info.code, message: info.message ?? '' });
    else await notifyTtsAccountCleared(this.env.NTFY_TOPIC, { code: info.code, minutes: info.minutes ?? 0, reset: info.reset ?? 0 });
  }

  /** The account works again: clips that failed only for the account are due now, and the pump runs. */
  private async recovered(problem: AccountProblem, now: number): Promise<void> {
    let reset = 0;
    try {
      if (this.env.DB) reset = await resetAccountFailures(this.env.DB, { now });
      if (this.env.TTS_QUEUE) await startPump(this.env);
    } catch (err) {
      console.error('[tts-limiter] recovery reset failed:', err instanceof Error ? err.message : err);
    }
    const minutes = Math.round((now - problem.since) / 60_000);
    console.log(JSON.stringify({ type: 'tts_limiter', event: 'account_cleared', code: problem.code, minutes, reset }));
    await this.notify('account_cleared', { code: problem.code, minutes, reset }).catch(() => {});
  }

  private save(): void {
    const storage = (this.ctx as DurableObjectState).storage;
    void storage.put('meta', {
      nightUntil: this.nightUntil,
      pumpLeaseUntil: this.pumpLeaseUntil,
      pumpToken: this.pumpToken,
      minutes: this.minutes,
    });
  }

  private saveAdaptive(): void {
    const storage = (this.ctx as DurableObjectState).storage;
    void storage.put('adaptive', this.adaptive);
  }

  private bounds() {
    return adaptiveBounds(this.env.MINIMAX_RPM, this.env.MINIMAX_RPM_MAX);
  }

  /** The learned rate after closing any finished minute (persisted when it changed). */
  private learned(now: number): AdaptiveState {
    const prev = this.adaptive ?? initialAdaptive(this.bounds(), now, null);
    this.adaptive = rollAdaptive(prev, this.bounds(), now);
    if (this.adaptive.rpm !== prev.rpm) this.logRateChange(prev.rpm);
    if (this.adaptive !== prev && (this.adaptive.rpm !== prev.rpm || this.adaptive.windowStart !== prev.windowStart)) this.saveAdaptive();
    return this.adaptive;
  }

  private logRateChange(from: number): void {
    const a = this.adaptive!;
    console.log(JSON.stringify({ type: 'tts_limiter', event: 'rpm_changed', from, rpm: a.rpm, reason: a.history[a.history.length - 1]?.reason }));
  }

  private cfg(now: number) {
    return limiterConfig(this.learned(now).rpm, now < this.nightUntil);
  }

  private bucket(now: number): BucketState {
    if (!this.state) this.state = initialState(this.cfg(now), now);
    return this.state;
  }

  private stat(now: number): MinuteStats {
    const minute = Math.floor(now / 60_000);
    let last = this.minutes[this.minutes.length - 1];
    if (!last || last.minute !== minute) {
      last = { minute, interactive: 0, batch: 0, denied: 0, rateLimited: 0, ok: 0, failed: 0 };
      this.minutes.push(last);
      this.minutes = this.minutes.filter((m) => m.minute > minute - KEEP_MINUTES);
      this.save();
    }
    return last;
  }

  private maybeLog(now: number): void {
    if (now - this.lastLog < LOG_EVERY_MS) return;
    this.lastLog = now;
    const cfg = this.cfg(now);
    const hour = this.minutes.filter((m) => m.minute > Math.floor(now / 60_000) - 60);
    const sum = (k: keyof MinuteStats) => hour.reduce((n, m) => n + (m[k] as number), 0);
    console.log(JSON.stringify({
      type: 'tts_limiter',
      rpm: cfg.rpm,
      night: now < this.nightUntil,
      tokens: Math.floor(this.state?.tokens ?? cfg.burst),
      last_hour: { interactive: sum('interactive'), batch: sum('batch'), denied: sum('denied'), rate_limited: sum('rateLimited'), ok: sum('ok'), failed: sum('failed') },
    }));
  }

  /** One slot for one MiniMax call, or how long to wait. */
  async acquire(priority: TtsPriority): Promise<{ granted: boolean; retryAfterMs: number; remaining: number; account?: number | string }> {
    await this.load();
    const now = Date.now();
    // An account problem pauses everyone (not demand the rate should learn from).
    const gate = accountGate(this.account, now);
    if (!gate.allowed) {
      return { granted: false, retryAfterMs: Math.max(1, Math.ceil(gate.retryAfterMs)), remaining: 0, account: this.account!.code };
    }
    const cfg = this.cfg(now);
    const result = tryAcquire(this.bucket(now), cfg, priority, now);
    this.state = result.state;
    if (gate.probe && result.granted) {
      // This call is the probe: the others wait for what it finds.
      this.account = markProbe(this.account!, now);
      this.saveAccount();
      console.log(JSON.stringify({ type: 'tts_limiter', event: 'account_probe', code: this.account.code, priority }));
    }
    const before = this.adaptive!;
    this.adaptive = noteRequest(before, this.bounds(), now, !result.granted);
    if (this.adaptive.demand !== before.demand) this.saveAdaptive();
    const s = this.stat(now);
    if (result.granted) s[priority] += 1;
    else s.denied += 1;
    this.maybeLog(now);
    return { granted: result.granted, retryAfterMs: result.retryAfterMs, remaining: result.remaining };
  }

  /**
   * What the call did: ok, failed, MiniMax said rate limit (→ everyone backs
   * off), or an account error (→ every call paused; returns for how long).
   */
  async report(outcome: TtsReport, detail?: { code: number | string; message: string }): Promise<{ pausedForMs?: number }> {
    await this.load();
    const now = Date.now();
    const s = this.stat(now);
    if (outcome === 'account_error') {
      s.failed += 1;
      const { problem, started } = noteAccountError(this.account, detail?.code ?? 'unknown', detail?.message ?? '', now);
      this.account = problem;
      this.saveAccount();
      this.save();
      console.warn(JSON.stringify({ type: 'tts_limiter', event: started ? 'account_problem' : 'account_still_failing', code: problem.code, message: problem.message, paused_until: new Date(problem.pausedUntil).toISOString(), streak: problem.streak }));
      if (started) await this.notify('account_problem', { code: problem.code, message: problem.message }).catch(() => {});
      return { pausedForMs: problem.pausedUntil - now };
    }
    const before = this.account;
    const after = noteCallOutcome(before, outcome);
    if (after.problem !== before) {
      this.account = after.problem;
      this.saveAccount();
      if (after.cleared && before) await this.recovered(before, now);
    }
    if (outcome === 'rate_limited') {
      s.rateLimited += 1;
      const from = this.learned(now).rpm;
      this.adaptive = noteRateLimited(this.adaptive!, this.bounds(), now);
      this.saveAdaptive();
      this.state = penalize(this.bucket(now), this.cfg(now), now);
      console.warn(JSON.stringify({ type: 'tts_limiter', event: 'minimax_rate_limited', from, rpm: this.adaptive.rpm }));
    } else if (outcome === 'ok') s.ok += 1;
    else s.failed += 1;
    this.save();
    return {};
  }

  /**
   * Admin "retry now" (audio_retry_failed): end a running account pause, so the
   * next call is the probe. Returns whether there was one.
   */
  async probeAccountNow(): Promise<boolean> {
    await this.load();
    if (!this.account) return false;
    this.account = { ...this.account, pausedUntil: Date.now(), probeAt: null };
    this.saveAccount();
    return true;
  }

  /** The nightly backfill: batch work may use more of the rate until `until`. */
  async setNight(until: number): Promise<void> {
    await this.load();
    this.nightUntil = until;
    this.save();
  }

  /** One backfill pump at a time: take (or renew, with the same token) the lease. */
  async claimPump(token: string, ttlMs: number): Promise<boolean> {
    await this.load();
    const now = Date.now();
    if (now < this.pumpLeaseUntil && this.pumpToken !== token) return false;
    this.pumpToken = token;
    this.pumpLeaseUntil = now + ttlMs;
    this.save();
    return true;
  }

  async releasePump(token: string): Promise<void> {
    await this.load();
    if (this.pumpToken !== token) return;
    this.pumpLeaseUntil = 0;
    this.save();
  }

  async snapshot(): Promise<LimiterSnapshot> {
    await this.load();
    const now = Date.now();
    const cfg = this.cfg(now);
    const bucket = refill(this.bucket(now), cfg, now); // a view; not stored
    const minute = Math.floor(now / 60_000);
    const learned = this.adaptive!;
    const bounds = this.bounds();
    return {
      rpm: cfg.rpm,
      learned_rpm: learned.rpm,
      rpm_floor: bounds.floor,
      rpm_cap: bounds.cap,
      last_rate_limited_at: learned.lastRateLimitedAt,
      rpm_history: learned.history,
      burst: cfg.burst,
      batch_share: cfg.batchShare,
      night_until: now < this.nightUntil ? this.nightUntil : null,
      tokens: Math.floor(bucket.tokens),
      batch_tokens: Math.floor(bucket.batchTokens),
      blocked_until: this.state && this.state.blockedUntil > now ? this.state.blockedUntil : null,
      pump_lease_until: this.pumpLeaseUntil > now ? this.pumpLeaseUntil : null,
      minutes: this.minutes.filter((m) => m.minute > minute - KEEP_MINUTES),
      account_problem: this.account,
    };
  }
}
