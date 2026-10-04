/**
 * Admin: the audio backlog (docs/AUDIO.md "Backfill"). Behind adminMiddleware;
 * the MCP admin tools `audio_backfill_status` / `audio_backfill_run` /
 * `audio_tts_compare` call these.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { backfillCounts, etaMinutes, priorityUserIds, selectBackfill, throughputPerMinute } from '../services/tts/backfill';
import { LIMITER_NAME } from '../services/tts/limiter';
import { enqueueClip, startPump } from '../services/tts/queue';
import { TTS_MODEL, ttsSettings } from '../services/tts/settings';
import { loadTtsConfig, storedClipPolicy } from '../services/tts/config';
import { providerStatuses } from './audio-settings';
import { limiterConfig } from '../services/tts/bucket';
import { callMiniMaxTTS } from '../services/audio';
import type { LimiterSnapshot } from '../durable/tts-limiter';
import { accountFailureCondition, resetAccountFailures } from '../services/tts/account';
import type { AccountProblem } from '../services/tts/account';

function accountProblemView(p: AccountProblem | null | undefined, now: number) {
  if (!p) return null;
  return {
    code: p.code,
    message: p.message,
    since: new Date(p.since).toISOString(),
    last_error_at: new Date(p.lastAt).toISOString(),
    errors_in_a_row: p.streak,
    paused_until: p.pausedUntil > now ? new Date(p.pausedUntil).toISOString() : null,
    probing: p.probeAt !== null,
    hint: 'Every MiniMax call is paused (no clip loses attempts); a probe call retries after the pause. Fix the account (credit attached to the API key), then audio_retry_failed to probe at once.',
  };
}

/** Failure rows that are waiting because of the account (the clips a recovery retries). */
async function accountFailureCount(db: D1Database, now: number): Promise<number> {
  const cond = accountFailureCondition();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM tts_clip_failures WHERE ${cond.sql} AND next_attempt_at > ?`)
    .bind(...cond.params, new Date(now).toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const routes = new Hono<{ Bindings: Env }>();
routes.use('/admin/audio/*', adminMiddleware);

async function snapshot(env: Env): Promise<LimiterSnapshot | null> {
  if (!env.TTS_LIMITER) return null;
  try {
    return await env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(LIMITER_NAME)).snapshot();
  } catch (err) {
    console.error('[audio-backfill] limiter snapshot failed', err);
    return null;
  }
}

routes.get('/admin/audio/backfill', async (c) => {
  const now = Date.now();
  const config = await loadTtsConfig(c.env);
  const settings = ttsSettings(c.env, config.providers.minimax.voices.default);
  const policy = await storedClipPolicy(c.env);
  const [counts, limiter, accountWaiting, providers] = await Promise.all([
    backfillCounts(c.env.DB, { now, settingsHash: settings.hash, acceptableHashes: policy.acceptableHashes }),
    snapshot(c.env),
    accountFailureCount(c.env.DB, now).catch(() => null),
    providerStatuses(c.env, config, now),
  ]);
  // The learned (AIMD) rate, not the env cap: that is what the backlog drains at.
  const cfg = limiterConfig(limiter?.learned_rpm ?? 8, !!limiter?.night_until);
  const sum = (k: 'interactive' | 'batch' | 'ok' | 'failed' | 'rateLimited' | 'denied') =>
    (limiter?.minutes ?? []).reduce((n, m) => n + m[k], 0);
  const throughput = throughputPerMinute(limiter?.minutes ?? [], now, Math.round(cfg.rpm * cfg.batchShare));
  const eta = etaMinutes(counts.backlog, throughput.per_minute);
  // What the batch share of the learned rate alone would give (no measurement needed).
  const learnedBatchPerMinute = Math.round(cfg.rpm * cfg.batchShare * 10) / 10;
  const etaLearned = etaMinutes(counts.backlog, learnedBatchPerMinute);
  return c.json({
    // First, so it can't be missed: null = MiniMax answers normally.
    account_problem: accountProblemView(limiter?.account_problem, now),
    // MiniMax has no balance / usage API for pay-as-you-go keys (only the Token Plan's
    // /v1/token_plan/remains, which refuses PAYG keys): check the console.
    account: { balance: null, balance_api: false, note: 'MiniMax publishes no balance API for pay-as-you-go keys — see platform.minimax.io → Billing.' },
    clips_waiting_on_account_errors: accountWaiting,
    // Per provider (docs/AUDIO.md "Providers"): configured / enabled / account / learned rate / last success + error.
    providers,
    stored_clips: {
      order: policy.order,
      primary: policy.primary,
      primary_unavailable: policy.primaryUnavailable,
      current_providers: policy.acceptable,
      upgrade_backup_clips: config.upgrade_backup_clips,
      live_order: config.live_order,
    },
    settings: { model: settings.model, voice: settings.voice, speed: settings.speed, hash: settings.hash },
    backlog: counts.backlog,
    kinds: counts.kinds,
    by_voice: counts.by_voice,
    failures: counts.failures,
    limiter: limiter
      ? {
          rpm: limiter.rpm,
          learned_rpm: limiter.learned_rpm,
          rpm_floor: limiter.rpm_floor,
          rpm_cap: limiter.rpm_cap,
          last_rate_limited_at: limiter.last_rate_limited_at ? new Date(limiter.last_rate_limited_at).toISOString() : null,
          rpm_history: limiter.rpm_history.slice(-10).map((h) => ({ ...h, at: new Date(h.at).toISOString() })),
          burst: limiter.burst,
          batch_share: limiter.batch_share,
          night: !!limiter.night_until,
          night_until: limiter.night_until ? new Date(limiter.night_until).toISOString() : null,
          tokens: limiter.tokens,
          blocked_until: limiter.blocked_until ? new Date(limiter.blocked_until).toISOString() : null,
          pump_running: !!limiter.pump_lease_until,
          last_hour: {
            interactive: sum('interactive'),
            batch: sum('batch'),
            ok: sum('ok'),
            failed: sum('failed'),
            rate_limited: sum('rateLimited'),
            denied: sum('denied'),
          },
        }
      : null,
    throughput,
    eta_minutes: eta,
    eta_at: eta === null ? null : new Date(now + eta * 60_000).toISOString(),
    eta_at_learned_rpm: {
      batch_per_minute: learnedBatchPerMinute,
      eta_minutes: etaLearned,
      eta_at: etaLearned === null ? null : new Date(now + etaLearned * 60_000).toISOString(),
    },
  });
});

/** `{ limit? }`: start the pump; with a limit, also queue the next `limit` backlog clips now (≤ 500). */
routes.post('/admin/audio/backfill/run', async (c) => {
  let limit = 0;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) limit = Math.max(0, Math.min(500, Math.round(body.limit)));
  } catch {
    // No body: just the pump
  }
  const policy = await storedClipPolicy(c.env);
  if (policy.order.length === 0) return c.json({ error: 'No TTS provider is configured and enabled for stored clips (/admin/audio)' }, 503);
  let queued = 0;
  if (limit > 0) {
    const now = Date.now();
    const items = await selectBackfill(c.env.DB, {
      now,
      limit,
      userIds: await priorityUserIds(c.env.DB, c.env.ADMIN_EMAIL, now),
      acceptableHashes: policy.acceptableHashes,
    });
    for (const item of items) if (await enqueueClip(c.env, { kind: item.kind, id: item.id }, { priority: 'batch' })) queued++;
  }
  await startPump(c.env);
  return c.json({ pump_started: true, queued });
});

/**
 * `{ error_code? }`: clips waiting out a failure are due again now (attempts → 0)
 * — those that failed with that code (a base_resp number or HTTP status), with
 * any account error (no code), or every failure (`'all'`). Also ends a running
 * account pause so the next call probes MiniMax, and starts the pump.
 */
routes.post('/admin/audio/retry-failed', async (c) => {
  let code: number | string | null = null;
  try {
    const body = await c.req.json<{ error_code?: number | string | null }>();
    if (typeof body?.error_code === 'number' || (typeof body?.error_code === 'string' && body.error_code.trim())) code = body.error_code;
  } catch {
    // No body: account errors
  }
  if (typeof code === 'string' && !/^(all|(http\s+)?\d{3,5})$/i.test(code.trim())) {
    return c.json({ error: 'error_code: a MiniMax code (2053), an HTTP status, or "all"' }, 400);
  }
  const now = Date.now();
  let reset: number;
  if (typeof code === 'string' && code.trim().toLowerCase() === 'all') {
    const res = await c.env.DB
      .prepare("UPDATE tts_clip_failures SET attempts = 0, next_attempt_at = ?, updated_at = datetime('now')")
      .bind(new Date(now).toISOString())
      .run();
    reset = res.meta?.changes ?? 0;
  } else {
    reset = await resetAccountFailures(c.env.DB, { code, now });
  }
  let probing = false;
  if (c.env.TTS_LIMITER) {
    // Every provider's pause ends: the next call to each probes it.
    for (const name of [LIMITER_NAME, 'azure', 'google']) {
      try {
        probing = (await c.env.TTS_LIMITER.get(c.env.TTS_LIMITER.idFromName(name)).probeAccountNow()) || probing;
      } catch (err) {
        console.error('[audio-backfill] probe failed', name, err);
      }
    }
  }
  const canPump = (await storedClipPolicy(c.env)).order.length > 0;
  if (canPump) await startPump(c.env);
  return c.json({ reset, error_code: code ?? 'account errors', account_probe_now: probing, pump_started: canPump });
});

/** MP3 duration at the pinned 128 kbps CBR encode. */
function seconds(bytes: number): number {
  return Math.round((bytes * 8 * 100) / 128_000) / 100;
}

/**
 * Calibration: the same sentence at the house voice and speed with the old and
 * the current model, with durations — does the new model speak at the same
 * perceived speed? (4 MiniMax calls at interactive priority.)
 */
routes.post('/admin/audio/compare', async (c) => {
  let text = '我今天早上七点起床，然后去公园跑步。';
  try {
    const body = await c.req.json<{ text?: string }>();
    if (typeof body?.text === 'string' && body.text.trim()) text = body.text.trim().slice(0, 200);
  } catch {
    // default text
  }
  const settings = ttsSettings(c.env);
  const out: Array<{ model: string; speed: number; seconds: number | null; error?: string }> = [];
  for (const model of ['speech-02-hd', TTS_MODEL]) {
    for (const speed of [settings.speed, 1]) {
      const r = await callMiniMaxTTS(c.env, text, speed, settings.voice, { priority: 'interactive', model });
      out.push(r.ok ? { model, speed, seconds: seconds(r.bytes.byteLength) } : { model, speed, seconds: null, error: r.reason });
    }
  }
  return c.json({ text, voice: settings.voice, results: out });
});

export default routes;
