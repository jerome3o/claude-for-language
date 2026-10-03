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
import { limiterConfig } from '../services/tts/bucket';
import { callMiniMaxTTS } from '../services/audio';
import type { LimiterSnapshot } from '../durable/tts-limiter';

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
  const settings = ttsSettings(c.env);
  const [counts, limiter] = await Promise.all([backfillCounts(c.env.DB, { now, settingsHash: settings.hash }), snapshot(c.env)]);
  const cfg = limiterConfig(c.env.MINIMAX_RPM, !!limiter?.night_until);
  const sum = (k: 'interactive' | 'batch' | 'ok' | 'failed' | 'rateLimited' | 'denied') =>
    (limiter?.minutes ?? []).reduce((n, m) => n + m[k], 0);
  const throughput = throughputPerMinute(limiter?.minutes ?? [], now, Math.round(cfg.rpm * cfg.batchShare));
  const eta = etaMinutes(counts.backlog, throughput.per_minute);
  return c.json({
    settings: { model: settings.model, voice: settings.voice, speed: settings.speed, hash: settings.hash },
    backlog: counts.backlog,
    kinds: counts.kinds,
    by_voice: counts.by_voice,
    failures: counts.failures,
    limiter: limiter
      ? {
          rpm: limiter.rpm,
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
  if (!c.env.MINIMAX_API_KEY) return c.json({ error: 'MiniMax is not configured' }, 503);
  let queued = 0;
  if (limit > 0) {
    const now = Date.now();
    const items = await selectBackfill(c.env.DB, {
      now,
      limit,
      userIds: await priorityUserIds(c.env.DB, c.env.ADMIN_EMAIL, now),
      settingsHash: ttsSettings(c.env).hash,
    });
    for (const item of items) if (await enqueueClip(c.env, { kind: item.kind, id: item.id }, { priority: 'batch' })) queued++;
  }
  await startPump(c.env);
  return c.json({ pump_started: true, queued });
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
