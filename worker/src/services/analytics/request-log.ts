/**
 * Structured request logs for Workers Observability: one JSON line per request
 * with the ROUTE PATTERN (`/api/decks/:id`, never the raw path with ids), user
 * id, status, duration and an error name — searchable in the Cloudflare
 * dashboard (`type = "request"`). Plus `bindAnalyticsScope`, which hands the
 * signed-in user and route to the analytics scope (server events, AI calls).
 */
import type { Context, MiddlewareHandler, Next } from 'hono';
import { matchedRoutes } from 'hono/route';
import { currentScope } from './scope';

/**
 * The pattern of the handler that answers the request ('unmatched' for a 404).
 * `c.req.routeIndex` is the handler running now: after `next()` that is the one
 * that produced the response; in a middleware it is the middleware itself, so
 * we take the first real (non-`use`) route from there on. Not simply the last
 * match — the SPA catch-all `app.get('*')` matches every GET.
 */
export function routePattern(c: Context): string {
  try {
    const routes = matchedRoutes(c);
    const start = Math.max(0, c.req.routeIndex ?? 0);
    for (let i = start; i < routes.length; i++) {
      const r = routes[i];
      if (r.method !== 'ALL' && r.path) return r.path === '/*' ? '*' : r.path;
    }
  } catch {
    // no match result (very early failure)
  }
  return 'unmatched';
}

export const requestLog: MiddlewareHandler = async (c: Context, next: Next) => {
  const start = Date.now();
  await next();
  try {
    const user = c.get('user') as { id?: string } | undefined;
    const err = c.error as Error | undefined;
    const line: Record<string, unknown> = {
      type: 'request',
      method: c.req.method,
      route: routePattern(c),
      status: c.res.status,
      duration_ms: Date.now() - start,
      user_id: user?.id ?? null,
    };
    if (err) line.error = `${err.name}: ${String(err.message).slice(0, 160)}`;
    else if (c.res.status >= 500) line.error = `http_${c.res.status}`;
    const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'log';
    console[level](JSON.stringify(line));
  } catch {
    // logging must never break a response
  }
};

export const bindAnalyticsScope: MiddlewareHandler = async (c: Context, next: Next) => {
  const scope = currentScope();
  if (scope) {
    const user = c.get('user') as { id?: string } | undefined;
    scope.userId = user?.id ?? null;
    scope.route = routePattern(c);
  }
  await next();
};
