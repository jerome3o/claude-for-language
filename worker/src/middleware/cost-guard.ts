/**
 * Per-user limits on the endpoints that cost money (security review M4, docs/ANALYTICS.md
 * "Cost guard"). Two checks, after sign-in:
 *
 * 1. RATE LIMITS by group, keyed by user id — Workers rate-limit bindings (wrangler.toml)
 *    when present, else a per-isolate fixed window with the same numbers (dev, tests):
 *    - `ai`   — model calls a person waits for (Ask Claude, Coach, Explain, transcription,
 *               answer checks, /api/ai/*, idioms): 60 a minute;
 *    - `tts`  — /api/practice/tts (mostly R2 hits; the TTS limiter paces real calls): 600 a minute;
 *    - `jobs` — POSTs that start background generation (audio lessons, readers, picture
 *               hunts, quests, podcast episodes, session notes / homework drafts, meme-review
 *               lessons, clips: generate / retry / learn-more): 10 a
 *               minute and 30 an hour (the hour in D1: the bindings only count 10 s / 60 s).
 * 2. A DAILY AI COST CAP per user (`AI_DAILY_COST_CAP_USD`, default $10; "0" / "off" turns
 *    it off) from the `server.ai_call` accounting in usage_events (services/analytics/
 *    ai-usage.ts), on the `ai` and `jobs` groups. Admins are exempt. Calls of users who
 *    opted out of usage data are not recorded, so the cap can't see them.
 *
 * Over a limit → 429 with a readable `error` (both apps show it as is), `code`, and
 * Retry-After. Generous on purpose: normal study and teaching never come near.
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import type { RateLimiterBinding } from '../services/podcast-feed';

export type CostGroup = 'ai' | 'tts' | 'jobs';

export const COST_LIMITS: Record<CostGroup, { perMinute: number; perHour?: number }> = {
  ai: { perMinute: 60 },
  tts: { perMinute: 600 },
  jobs: { perMinute: 10, perHour: 30 },
};

export const DEFAULT_DAILY_AI_COST_CAP_USD = 10;
/** How long one isolate trusts a user's spend total before asking D1 again. */
export const COST_CACHE_MS = 60_000;

const AI_PATHS: RegExp[] = [
  /^\/api\/ai\//,
  /^\/api\/sentence(\/|$)/,
  /^\/api\/sentences\/explain-text$/,
  /^\/api\/sentences\/[^/]+\/explain$/,
  /^\/api\/coach\//,
  /^\/api\/transcribe(\/|$)/,
  /^\/api\/notes\/[^/]+\/ask$/,
  /^\/api\/lessons\/answer-check(\/|$)/,
  /^\/api\/lessons\/sentence-feedback$/,
  /^\/api\/idioms$/,
];

const JOB_PATHS: RegExp[] = [
  /^\/api\/audio-lessons$/,
  /^\/api\/audio-lessons\/[^/]+\/(companion-lesson|retry)$/,
  /^\/api\/readers\/generate$/,
  /^\/api\/readers\/[^/]+\/retry$/,
  /^\/api\/picture-hunts$/,
  /^\/api\/picture-hunts\/upload$/,
  /^\/api\/picture-hunts\/[^/]+\/retry$/,
  /^\/api\/quests$/,
  /^\/api\/quests\/[^/]+\/retry$/,
  /^\/api\/podcasts\/episodes$/,
  /^\/api\/podcasts\/episodes\/[^/]+\/(retry|lesson)$/,
  /^\/api\/relationships\/[^/]+\/session-notes$/,
  /^\/api\/relationships\/[^/]+\/session-notes\/[^/]+\/retry$/,
  /^\/api\/calls\/[^/]+\/homework$/,
  /^\/api\/relationships\/[^/]+\/lesson-notes$/,
  /^\/api\/relationships\/[^/]+\/lesson-notes\/[^/]+\/draft$/,
  /^\/api\/relationships\/[^/]+\/homework-drafts\/[^/]+\/messages$/,
  /^\/api\/meme-review\/[^/]+\/lesson$/,
  /^\/api\/clips\/generate$/,
  /^\/api\/clips\/[^/]+\/(learn-more|retry)$/,
];

/** Which costly group a request belongs to (null = not limited). Reads never count. Pure. */
export function costGroupFor(method: string, path: string): CostGroup | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  if (path === '/api/practice/tts') return 'tts';
  if (JOB_PATHS.some((re) => re.test(path))) return 'jobs';
  if (AI_PATHS.some((re) => re.test(path))) return 'ai';
  return null;
}

/** `AI_DAILY_COST_CAP_USD` → dollars, or null = no cap. */
export function dailyCostCap(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return DEFAULT_DAILY_AI_COST_CAP_USD;
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === 'none') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_AI_COST_CAP_USD;
  return n > 0 ? n : null;
}

export function secondsUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

export function rateLimitMessage(group: CostGroup, window: 'minute' | 'hour'): string {
  if (window === 'hour') {
    return `You've started ${COST_LIMITS.jobs.perHour} generations in the last hour — please wait a little before starting another.`;
  }
  if (group === 'tts') return 'Too many audio requests in a minute — wait a moment and try again.';
  if (group === 'jobs') return "You're starting a lot of things at once — please wait a minute and try again.";
  return "You're asking Claude very quickly — please wait a minute and try again.";
}

export function dailyCapMessage(capUsd: number): string {
  const cap = Number.isInteger(capUsd) ? `$${capUsd}` : `$${capUsd.toFixed(2)}`;
  return `You've reached today's AI limit (${cap} a day). It resets at midnight UTC — studying and everything else still work.`;
}

// ---------- counting ----------

type GuardEnv = Pick<Env, 'DB' | 'ADMIN_EMAIL' | 'E2E_TEST_MODE' | 'AI_DAILY_COST_CAP_USD' | 'AI_RATE_LIMITER' | 'TTS_RATE_LIMITER' | 'JOB_RATE_LIMITER'>;

const windows = new Map<string, { start: number; count: number }>();

/** Tests: forget the in-memory windows and the cached spend. */
export function resetCostGuard(): void {
  windows.clear();
  spend.clear();
}

function memoryAllow(key: string, limit: number, periodMs: number, now: number): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= periodMs) {
    if (windows.size > 10_000) windows.clear();
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

function bindingFor(env: GuardEnv, group: CostGroup): RateLimiterBinding | undefined {
  return group === 'ai' ? env.AI_RATE_LIMITER : group === 'tts' ? env.TTS_RATE_LIMITER : env.JOB_RATE_LIMITER;
}

export async function allowPerMinute(env: GuardEnv, group: CostGroup, userId: string, now = Date.now()): Promise<boolean> {
  const key = `${group}:${userId}`;
  const binding = bindingFor(env, group);
  if (binding) {
    try {
      return (await binding.limit({ key })).success;
    } catch {
      // the limiter failing must not take the feature down — fall back to memory
    }
  }
  return memoryAllow(`m:${key}`, COST_LIMITS[group].perMinute, 60_000, now);
}

/** Jobs an hour: a fixed-window counter in D1 (one row per user). Fails open. */
export async function allowPerHour(env: GuardEnv, userId: string, now = Date.now()): Promise<boolean> {
  const limit = COST_LIMITS.jobs.perHour!;
  const window = Math.floor(now / 3_600_000);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limit_counters (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limit_counters.window_start = excluded.window_start THEN rate_limit_counters.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
      .bind(`jobs:${userId}`, window)
      .first<{ count: number }>();
    return (row?.count ?? 1) <= limit;
  } catch (err) {
    console.warn('[cost-guard] hourly counter unavailable:', err instanceof Error ? err.message : err);
    return memoryAllow(`h:jobs:${userId}`, limit, 3_600_000, now);
  }
}

const spend = new Map<string, { at: number; usd: number }>();

/** The user's estimated AI spend since UTC midnight (usage_events `server.ai_call`), cached a minute. */
export async function aiSpendToday(db: D1Database, userId: string, now = Date.now()): Promise<number> {
  const cached = spend.get(userId);
  if (cached && now - cached.at < COST_CACHE_MS) return cached.usd;
  const d = new Date(now);
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  let usd = 0;
  try {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(json_extract(props, '$.cost_usd'), 0)), 0) AS usd
           FROM usage_events WHERE user_id = ? AND ts >= ? AND event = 'server.ai_call'`,
      )
      .bind(userId, since)
      .first<{ usd: number }>();
    usd = Number(row?.usd) || 0;
  } catch (err) {
    console.warn('[cost-guard] spend lookup failed:', err instanceof Error ? err.message : err);
  }
  if (spend.size > 5_000) spend.clear();
  spend.set(userId, { at: now, usd });
  return usd;
}

function tooMany(c: Context, body: { error: string; code: string; retry_after: number }) {
  c.header('Retry-After', String(body.retry_after));
  return c.json(body, 429);
}

/** The middleware (mounted after authMiddleware on /api/*). */
export async function costGuard(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const group = costGroupFor(c.req.method, c.req.path);
  if (!group) return next();
  const env = c.env as GuardEnv;
  if (env.E2E_TEST_MODE === 'true') return next();
  const user = c.get('user') as { id?: string; email?: string | null; is_admin?: number | boolean } | undefined;
  if (!user?.id) return next();
  const now = Date.now();

  if (!(await allowPerMinute(env, group, user.id, now))) {
    console.warn(JSON.stringify({ type: 'cost_guard', reason: 'per_minute', group, user_id: user.id }));
    return tooMany(c, { error: rateLimitMessage(group, 'minute'), code: 'rate_limited', retry_after: 60 });
  }
  if (group === 'jobs' && !(await allowPerHour(env, user.id, now))) {
    console.warn(JSON.stringify({ type: 'cost_guard', reason: 'per_hour', group, user_id: user.id }));
    return tooMany(c, { error: rateLimitMessage(group, 'hour'), code: 'rate_limited', retry_after: 3600 - Math.floor((now % 3_600_000) / 1000) });
  }

  const isAdmin = !!user.is_admin || (!!env.ADMIN_EMAIL && !!user.email && user.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
  const cap = dailyCostCap(env.AI_DAILY_COST_CAP_USD);
  if (group !== 'tts' && cap !== null && !isAdmin && env.DB) {
    const usd = await aiSpendToday(env.DB, user.id, now);
    if (usd >= cap) {
      console.warn(JSON.stringify({ type: 'cost_guard', reason: 'daily_ai_cap', group, user_id: user.id, cost_usd: Math.round(usd * 100) / 100, cap_usd: cap }));
      return tooMany(c, { error: dailyCapMessage(cap), code: 'daily_ai_limit', retry_after: secondsUntilUtcMidnight(now) });
    }
  }
  return next();
}
