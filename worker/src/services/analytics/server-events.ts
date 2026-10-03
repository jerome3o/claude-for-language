/**
 * Server-side usage events (docs/ANALYTICS.md): ONE helper, `trackServer`, for
 * API actions that matter — content created, homework assigned, AI calls (with
 * model, tokens and a cost estimate), push and e-mail sent. Rows go to the same
 * `usage_events` table the apps upload to, with platform `server`.
 *
 * Same rules as the clients: catalogue events only, props through the privacy
 * filter, the `ANALYTICS_LEVEL` kill switch and the user's `analytics_opt_out`
 * (checked inside the INSERT). Never throws, never blocks the response.
 */
import { eventAllowedAtLevel, parseAnalyticsLevel, sanitizeProps, type AnalyticsEventName } from '@shared/analytics';
import type { Env } from '../../types';
import { currentScope, keepAlive } from './scope';

export function analyticsLevel(env: Pick<Env, 'ANALYTICS_LEVEL'> | undefined) {
  return parseAnalyticsLevel(env?.ANALYTICS_LEVEL);
}

function newId(): string {
  try {
    return `srv_${crypto.randomUUID()}`;
  } catch {
    return `srv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Writes one server event; returns the write so a caller may await it (tests, cron). */
export function trackServer(
  event: AnalyticsEventName,
  props: Record<string, unknown> = {},
  opts: { env?: Env; userId?: string | null } = {}
): Promise<void> {
  const write = (async () => {
    const scope = currentScope();
    const env = opts.env ?? scope?.env;
    if (!env?.DB) return;
    if (!eventAllowedAtLevel(event, analyticsLevel(env))) return;
    const userId = opts.userId !== undefined ? opts.userId : scope?.userId ?? null;
    const clean = sanitizeProps(event, { route: scope?.route ?? undefined, ...props });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO usage_events (id, user_id, ts, received_at, platform, app_version, session_id, event, screen, props)
       SELECT ?1, ?2, ?3, ?3, 'server', NULL, NULL, ?4, ?5, ?6
       WHERE ?2 IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = ?2 AND analytics_opt_out = 1)`
    )
      .bind(newId(), userId, now, event, scope?.route ?? null, JSON.stringify(clean))
      .run();
  })().catch((err) => {
    console.warn('[analytics] server event failed:', event, err instanceof Error ? err.message : err);
  });
  keepAlive(write);
  return write;
}
