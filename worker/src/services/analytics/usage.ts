/**
 * usage_events: storing the apps' uploads, pruning, and the admin questions the
 * MCP tools ask (docs/ANALYTICS.md). Timestamps are ISO-8601 UTC strings, so
 * string comparison is time order.
 */
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  SCREEN_REPLACED_BY,
  USAGE_RETENTION_DAYS,
  eventAllowedAtLevel,
  parseUsageUpload,
  type AnalyticsEventDef,
  type AnalyticsLevel,
} from '@shared/analytics';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `since` / `from` / `to` as an ISO string: accepts a date (2026-10-01), a timestamp, or "Nd" (days back). */
export function parseSince(raw: string | null | undefined, now: number, fallbackDays: number): string {
  const v = (raw ?? '').trim();
  const days = /^(\d{1,4})d$/.exec(v);
  if (days) return new Date(now - Number(days[1]) * DAY_MS).toISOString();
  const t = v ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) ? t : now - fallbackDays * DAY_MS).toISOString();
}

export interface StoreResult {
  accepted: number;
  stored: number;
  rejected: number;
  opted_out: boolean;
}

/** Stores one upload for `userId` (idempotent by id). */
export async function storeUsageEvents(
  db: D1Database,
  userId: string,
  body: unknown,
  opts: { now: number; level: AnalyticsLevel; optedOut: boolean }
): Promise<StoreResult | { error: string }> {
  const parsed = parseUsageUpload(body, opts.now);
  if ('error' in parsed) return parsed;
  const accepted = parsed.events.length;
  if (opts.optedOut || opts.level === 'off') return { accepted, stored: 0, rejected: parsed.rejected, opted_out: opts.optedOut };
  const keep = parsed.events.filter((e) => eventAllowedAtLevel(e.event, opts.level));
  if (!keep.length) return { accepted, stored: 0, rejected: parsed.rejected, opted_out: false };
  const received = new Date(opts.now).toISOString();
  const stmts = keep.map((e) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO usage_events (id, user_id, ts, received_at, platform, app_version, session_id, event, screen, props)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(e.id, userId, e.ts, received, e.platform, e.app_version, e.session_id, e.event, e.screen, JSON.stringify(e.props))
  );
  let stored = 0;
  // D1 batches are capped; 100 statements at a time.
  for (let i = 0; i < stmts.length; i += 100) {
    const results = await db.batch(stmts.slice(i, i + 100));
    stored += results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  }
  return { accepted, stored, rejected: parsed.rejected, opted_out: false };
}

/** Deletes rows older than the retention window. Returns how many went. */
export async function pruneUsageEvents(db: D1Database, now: number, days = USAGE_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const res = await db.prepare('DELETE FROM usage_events WHERE ts < ?').bind(cutoff).run();
  return res.meta?.changes ?? 0;
}

const parseProps = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

// ─── admin questions ──────────────────────────────────────────────────────

export async function usageSummary(db: D1Database, userId: string, since: string) {
  const [days, platforms, screens, events, versions] = await Promise.all([
    db
      .prepare(`SELECT COUNT(DISTINCT substr(ts, 1, 10)) AS active_days, COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions, MIN(ts) AS first_ts, MAX(ts) AS last_ts
                FROM usage_events WHERE user_id = ? AND ts >= ? AND platform != 'server'`)
      .bind(userId, since)
      .first<{ active_days: number; events: number; sessions: number; first_ts: string | null; last_ts: string | null }>(),
    db
      .prepare(`SELECT platform, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT substr(ts, 1, 10)) AS active_days, COUNT(*) AS events,
                       SUM(CASE WHEN event = 'app.screen_view' THEN COALESCE(json_extract(props, '$.duration_ms'), 0) ELSE 0 END) AS time_ms,
                       MAX(ts) AS last_seen
                FROM usage_events WHERE user_id = ? AND ts >= ? AND platform != 'server' GROUP BY platform ORDER BY last_seen DESC`)
      .bind(userId, since)
      .all<{ platform: string; sessions: number; active_days: number; events: number; time_ms: number; last_seen: string }>(),
    db
      .prepare(`SELECT screen, COUNT(*) AS views, SUM(COALESCE(json_extract(props, '$.duration_ms'), 0)) AS time_ms
                FROM usage_events WHERE user_id = ? AND ts >= ? AND event = 'app.screen_view' AND screen IS NOT NULL
                GROUP BY screen ORDER BY time_ms DESC, views DESC LIMIT 20`)
      .bind(userId, since)
      .all<{ screen: string; views: number; time_ms: number }>(),
    db
      .prepare(`SELECT event, COUNT(*) AS count, MAX(ts) AS last_ts FROM usage_events
                WHERE user_id = ? AND ts >= ? AND event != 'app.screen_view' GROUP BY event ORDER BY count DESC LIMIT 25`)
      .bind(userId, since)
      .all<{ event: string; count: number; last_ts: string }>(),
    db
      .prepare(`SELECT platform, app_version, MAX(ts) AS last_seen, COUNT(*) AS events FROM usage_events
                WHERE user_id = ? AND platform != 'server' GROUP BY platform, app_version ORDER BY last_seen DESC LIMIT 10`)
      .bind(userId)
      .all<{ platform: string; app_version: string | null; last_seen: string; events: number }>(),
  ]);
  const minutes = (ms: number) => Math.round((Number(ms) || 0) / 6000) / 10;
  return {
    since,
    active_days: days?.active_days ?? 0,
    sessions: days?.sessions ?? 0,
    events: days?.events ?? 0,
    first_event_at: days?.first_ts ?? null,
    last_event_at: days?.last_ts ?? null,
    platforms: (platforms.results ?? []).map((p) => ({ ...p, time_in_app_min: minutes(p.time_ms), time_ms: undefined })),
    top_screens: (screens.results ?? []).map((s) => ({ screen: s.screen, views: s.views, time_min: minutes(s.time_ms) })),
    top_events: events.results ?? [],
    last_seen_by_version: versions.results ?? [],
  };
}

export interface FeatureUse {
  event: string;
  area: string;
  description: string;
  count: number;
  first_used: string | null;
  last_used: string | null;
  users?: number;
}

/**
 * For every catalogue event: first / last use and count (one user, or everyone),
 * plus never-used, stale (not in `staleDays`) and old-path-still-in-use lists.
 */
export async function featureAdoption(db: D1Database, opts: { userId: string | null; since: string; now: number; staleDays?: number }) {
  const where = opts.userId ? 'user_id = ? AND ts >= ?' : 'ts >= ?';
  const binds = opts.userId ? [opts.userId, opts.since] : [opts.since];
  const [byEvent, byScreen] = await Promise.all([
    db
      .prepare(`SELECT event, COUNT(*) AS count, MIN(ts) AS first_used, MAX(ts) AS last_used, COUNT(DISTINCT user_id) AS users
                FROM usage_events WHERE ${where} GROUP BY event`)
      .bind(...binds)
      .all<{ event: string; count: number; first_used: string; last_used: string; users: number }>(),
    db
      .prepare(`SELECT screen, COUNT(*) AS count, MAX(ts) AS last_used FROM usage_events
                WHERE ${where} AND event = 'app.screen_view' AND screen IS NOT NULL GROUP BY screen`)
      .bind(...binds)
      .all<{ screen: string; count: number; last_used: string }>(),
  ]);
  const used = new Map((byEvent.results ?? []).map((r) => [r.event, r]));
  const staleCutoff = new Date(opts.now - (opts.staleDays ?? 30) * DAY_MS).toISOString();
  const features: FeatureUse[] = ANALYTICS_EVENT_NAMES.map((name) => {
    const def = ANALYTICS_EVENTS[name] as AnalyticsEventDef;
    const row = used.get(name);
    return {
      event: name,
      area: def.area,
      description: def.description,
      count: row?.count ?? 0,
      first_used: row?.first_used ?? null,
      last_used: row?.last_used ?? null,
      ...(opts.userId ? {} : { users: row?.users ?? 0 }),
    };
  });
  const oldPaths: Array<{ old: string; replaced_by: string; old_count: number; old_last_used: string | null; new_count: number }> = [];
  for (const f of features) {
    const repl = (ANALYTICS_EVENTS[f.event as keyof typeof ANALYTICS_EVENTS] as AnalyticsEventDef).replacedBy;
    if (repl && f.count > 0) {
      oldPaths.push({ old: f.event, replaced_by: repl, old_count: f.count, old_last_used: f.last_used, new_count: used.get(repl)?.count ?? 0 });
    }
  }
  const screens = new Map((byScreen.results ?? []).map((r) => [r.screen, r]));
  for (const [oldScreen, newScreen] of Object.entries(SCREEN_REPLACED_BY)) {
    const s = screens.get(oldScreen);
    if (s) oldPaths.push({ old: `screen ${oldScreen}`, replaced_by: `screen ${newScreen}`, old_count: s.count, old_last_used: s.last_used, new_count: screens.get(newScreen)?.count ?? 0 });
  }
  const isClient = (f: FeatureUse) => !(ANALYTICS_EVENTS[f.event as keyof typeof ANALYTICS_EVENTS] as AnalyticsEventDef).server;
  return {
    since: opts.since,
    never_used: features.filter((f) => f.count === 0 && isClient(f)).map((f) => ({ event: f.event, area: f.area, description: f.description })),
    stale: features.filter((f) => f.count > 0 && f.last_used! < staleCutoff).map((f) => ({ event: f.event, last_used: f.last_used, count: f.count })),
    old_path_in_use: oldPaths,
    features,
    screens: [...screens.values()].sort((a, b) => b.count - a.count),
  };
}

export async function userTimeline(db: D1Database, userId: string, opts: { from: string; to: string; limit: number; includeScreens: boolean }) {
  const { results } = await db
    .prepare(`SELECT ts, platform, app_version, session_id, event, screen, props FROM usage_events
              WHERE user_id = ? AND ts >= ? AND ts < ? ${opts.includeScreens ? '' : "AND event != 'app.screen_view'"}
              ORDER BY ts ASC, id ASC LIMIT ?`)
    .bind(userId, opts.from, opts.to, opts.limit + 1)
    .all<{ ts: string; platform: string; app_version: string | null; session_id: string | null; event: string; screen: string | null; props: string }>();
  const rows = results ?? [];
  return {
    from: opts.from,
    to: opts.to,
    truncated: rows.length > opts.limit,
    events: rows.slice(0, opts.limit).map((r) => ({ ...r, props: parseProps(r.props) })),
  };
}

export type CountGroup = 'day' | 'user' | 'platform' | 'event';

export async function eventCounts(db: D1Database, opts: { event: string; groupBy: CountGroup; since: string; userId: string | null }) {
  const pattern = opts.event.endsWith('*') || opts.event.endsWith('.') ? opts.event.replace(/\*$/, '') : null;
  const conds = [pattern ? "e.event LIKE ? ESCAPE '\\'" : 'e.event = ?', 'e.ts >= ?'];
  const binds: unknown[] = [pattern ? `${pattern.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : opts.event, opts.since];
  if (opts.userId) {
    conds.push('e.user_id = ?');
    binds.push(opts.userId);
  }
  const key =
    opts.groupBy === 'day' ? 'substr(e.ts, 1, 10)' : opts.groupBy === 'platform' ? 'e.platform' : opts.groupBy === 'event' ? 'e.event' : 'e.user_id';
  const { results } = await db
    .prepare(`SELECT ${key} AS key, COUNT(*) AS count, MAX(e.ts) AS last_ts${opts.groupBy === 'user' ? ', MAX(u.email) AS email, MAX(u.name) AS name' : ''}
              FROM usage_events e ${opts.groupBy === 'user' ? 'LEFT JOIN users u ON u.id = e.user_id' : ''}
              WHERE ${conds.join(' AND ')} GROUP BY key ORDER BY ${opts.groupBy === 'day' ? 'key ASC' : 'count DESC'} LIMIT 400`)
    .bind(...binds)
    .all<Record<string, unknown>>();
  const rows = results ?? [];
  return { event: opts.event, group_by: opts.groupBy, since: opts.since, total: rows.reduce((n, r) => n + Number(r.count || 0), 0), rows };
}

export async function recentErrors(db: D1Database, opts: { userId: string | null; since: string; limit: number }) {
  const userCond = opts.userId ? 'AND e.user_id = ?' : '';
  const cUserCond = opts.userId ? 'AND c.user_id = ?' : '';
  const [shown, crashes] = await Promise.all([
    db
      .prepare(`SELECT e.ts, e.platform, e.app_version, e.screen, e.props, e.user_id, u.email FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
                WHERE e.event = 'error.shown' AND e.ts >= ? ${userCond} ORDER BY e.ts DESC LIMIT ?`)
      .bind(...[opts.since, ...(opts.userId ? [opts.userId] : []), opts.limit])
      .all<{ ts: string; platform: string; app_version: string | null; screen: string | null; props: string; user_id: string; email: string | null }>(),
    db
      .prepare(`SELECT c.id, c.client, c.app_version, c.source, c.reason, c.thread, c.description, substr(c.trace, 1, 1200) AS trace,
                       COALESCE(c.occurred_at, c.created_at) AS at, c.user_id, u.email
                FROM crash_reports c LEFT JOIN users u ON u.id = c.user_id
                WHERE c.created_at >= ? ${cUserCond} ORDER BY c.created_at DESC LIMIT ?`)
      .bind(...[opts.since.replace('T', ' ').slice(0, 19), ...(opts.userId ? [opts.userId] : []), opts.limit])
      .all<Record<string, unknown>>(),
  ]);
  const errors = (shown.results ?? []).map((r) => ({ ...r, props: parseProps(r.props) }));
  const byCode = new Map<string, number>();
  for (const e of errors) {
    const k = `${(e.props as Record<string, unknown>).where ?? '?'}:${(e.props as Record<string, unknown>).code ?? (e.props as Record<string, unknown>).status ?? '?'}`;
    byCode.set(k, (byCode.get(k) ?? 0) + 1);
  }
  return {
    since: opts.since,
    errors_shown: errors,
    errors_by_place: [...byCode.entries()].map(([where_code, count]) => ({ where_code, count })).sort((a, b) => b.count - a.count),
    crashes: crashes.results ?? [],
  };
}

export type AiGroup = 'model' | 'day' | 'user' | 'route' | 'provider';

export async function aiUsage(db: D1Database, opts: { since: string; groupBy: AiGroup; userId: string | null }) {
  const key =
    opts.groupBy === 'day'
      ? 'substr(e.ts, 1, 10)'
      : opts.groupBy === 'user'
        ? 'e.user_id'
        : opts.groupBy === 'route'
          ? "COALESCE(json_extract(e.props, '$.route'), e.screen, 'background')"
          : opts.groupBy === 'provider'
            ? "json_extract(e.props, '$.provider')"
            : "json_extract(e.props, '$.model')";
  const userCond = opts.userId ? 'AND e.user_id = ?' : '';
  const { results } = await db
    .prepare(`SELECT ${key} AS key, COUNT(*) AS calls,
                     SUM(COALESCE(json_extract(e.props, '$.input_tokens'), 0)) AS input_tokens,
                     SUM(COALESCE(json_extract(e.props, '$.output_tokens'), 0)) AS output_tokens,
                     SUM(COALESCE(json_extract(e.props, '$.cache_read_tokens'), 0)) AS cache_read_tokens,
                     ROUND(SUM(COALESCE(json_extract(e.props, '$.cost_usd'), 0)), 4) AS cost_usd
                     ${opts.groupBy === 'user' ? ', MAX(u.email) AS email' : ''}
              FROM usage_events e ${opts.groupBy === 'user' ? 'LEFT JOIN users u ON u.id = e.user_id' : ''}
              WHERE e.event = 'server.ai_call' AND e.ts >= ? ${userCond}
              GROUP BY key ORDER BY ${opts.groupBy === 'day' ? 'key ASC' : 'cost_usd DESC'} LIMIT 400`)
    .bind(...[opts.since, ...(opts.userId ? [opts.userId] : [])])
    .all<Record<string, unknown>>();
  const rows = results ?? [];
  const sum = (k: string) => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
  return {
    since: opts.since,
    group_by: opts.groupBy,
    totals: { calls: sum('calls'), input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), cost_usd: Math.round(sum('cost_usd') * 10000) / 10000 },
    cost_note: 'cost_usd is an estimate from list prices per million tokens (worker/src/services/analytics/ai-usage.ts MODEL_PRICES).',
    rows,
  };
}
