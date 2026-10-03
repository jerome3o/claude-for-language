/**
 * Usage analytics tools (docs/ANALYTICS.md), admin only: what people actually do
 * in the apps — "Minghui hasn't used X yet", "she still uses the old Y".
 *
 * Every tool calls the main API as the signed-in user; the API's
 * adminMiddleware answers 403 for anyone else (worker/src/routes/analytics.ts).
 * `user` is an id or an email. `since` / `from` / `to` take a date
 * (2026-10-01), an ISO timestamp, or "Nd" (days back, e.g. "14d").
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

const USER = z.string().min(1).describe('The account: a user id or its email address (case-insensitive).');
const SINCE = z
  .string()
  .optional()
  .describe('Start of the window: a date (2026-10-01), an ISO timestamp, or "Nd" for N days back (e.g. "14d").');

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
};

export function registerUsageTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'usage_summary',
    'ADMIN ONLY. How one person uses the apps: active days, sessions, events, time in app per platform (web / pwa / android-hybrid / lab, from screen-view durations), top screens by time, top feature events, and last seen per platform + app version (spot an old Lab build). Default window 30 days.',
    { user: USER, since: SINCE },
    async ({ user, since }) => guard(async () => jsonResult(await api.get('/api/admin/usage/summary', q({ user, since }))))
  );

  server.tool(
    'feature_adoption',
    'ADMIN ONLY. For every feature event in the catalogue (shared/analytics/events.ts): first used, last used and count — for one user, or everyone when `user` is omitted (then also how many users). Highlights `never_used` features, `stale` ones (not used in `stale_days`, default 30) and `old_path_in_use` (an old event or screen that has a newer replacement, with how often each is used — "she was using the old thing here"). Default window 180 days.',
    { user: USER.optional(), since: SINCE, stale_days: z.number().int().min(1).max(365).optional() },
    async ({ user, since, stale_days }) =>
      guard(async () => jsonResult(await api.get('/api/admin/usage/adoption', q({ user, since, stale_days }))))
  );

  server.tool(
    'user_timeline',
    'ADMIN ONLY. Everything one person did, in order: each event with time, platform, app version, session, screen and its props (ids / enums / counts — never text). Pass `date` (YYYY-MM-DD, with `tz_offset_minutes` for their local day — e.g. 480 for China) or `from` / `to`. `include_screens: false` hides screen views. Up to `limit` (default 500) events; `truncated` says when there were more.',
    {
      user: USER,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      tz_offset_minutes: z.number().int().min(-840).max(840).optional().describe('Minutes ahead of UTC of the person\'s local time (China = 480, UK summer = 60).'),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(2000).optional(),
      include_screens: z.boolean().optional(),
    },
    async ({ user, date, tz_offset_minutes, from, to, limit, include_screens }) =>
      guard(async () =>
        jsonResult(
          await api.get(
            '/api/admin/usage/timeline',
            q({ user, date, tz_offset: tz_offset_minutes, from, to, limit, screens: include_screens === false ? 0 : undefined })
          )
        )
      )
  );

  server.tool(
    'event_counts',
    'ADMIN ONLY. How often an event happened: `event` is a name (chat.send) or a prefix ending in "." or "*" (chat. / call.*), grouped by day, user, platform or event. Optional `user` narrows to one person. Default window 30 days.',
    {
      event: z.string().min(1).max(80),
      group_by: z.enum(['day', 'user', 'platform', 'event']).optional(),
      since: SINCE,
      user: USER.optional(),
    },
    async ({ event, group_by, since, user }) =>
      guard(async () => jsonResult(await api.get('/api/admin/usage/counts', q({ event, group_by: group_by ?? 'day', since, user }))))
  );

  server.tool(
    'recent_errors',
    'ADMIN ONLY. Errors people actually saw (error.shown events: where, code, HTTP status, screen, app version), grouped by place, plus the Lab app\'s crash / freeze reports (crash_reports, trace trimmed). Optional `user`. Default window 14 days.',
    { user: USER.optional(), since: SINCE, limit: z.number().int().min(1).max(200).optional() },
    async ({ user, since, limit }) => guard(async () => jsonResult(await api.get('/api/admin/usage/errors', q({ user, since, limit }))))
  );

  server.tool(
    'ai_usage',
    'ADMIN ONLY. Model calls made by the worker (Anthropic + Gemini): calls, input / output / cache-read tokens and an ESTIMATED cost in USD, grouped by model, day, user, route (the API endpoint that made the call, or the queue) or provider. Optional `user`. Default window 30 days.',
    {
      since: SINCE,
      group_by: z.enum(['model', 'day', 'user', 'route', 'provider']).optional(),
      user: USER.optional(),
    },
    async ({ since, group_by, user }) =>
      guard(async () => jsonResult(await api.get('/api/admin/usage/ai', q({ since, group_by: group_by ?? 'model', user }))))
  );
}
