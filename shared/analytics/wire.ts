/**
 * The upload format of POST /api/me/usage-events and its validation (worker;
 * pure, unit-tested). Clients send `{ events: UsageEventInput[] }`; the server
 * keeps catalogue events only, runs the privacy filter again and is idempotent
 * by event id.
 */
import { ANALYTICS_PLATFORMS, isClientEvent, type AnalyticsPlatform } from './events';
import { isSafeToken, sanitizeProps, screenName, type AnalyticsProps } from './privacy';

/**
 * Where the apps upload their queued events. NOT `/api/analytics/events`: content
 * blockers (uBlock Origin, AdGuard, Brave, Ghostery — anything with EasyPrivacy) carry
 * the generic rule `/analytics/event`, which matches that path on ANY site, so the
 * browser refused the request before it left the page (ERR_BLOCKED_BY_CLIENT): no
 * web event reached D1 from a browser with a blocker (Oct 2026). The path must stay
 * free of tracker-ish words — `analyticsUploadPathProblems` is the test's check.
 */
export const USAGE_UPLOAD_PATH = '/api/me/usage-events';
/** The first path, still served for Lab builds that predate the move (okhttp has no blocker). */
export const LEGACY_USAGE_UPLOAD_PATH = '/api/analytics/events';

/**
 * Generic (any-site) blocking rules from EasyPrivacy / uBlock / AdGuard tracking lists that
 * an upload path must not match — a substring of the URL path, as those rules match.
 */
export const BLOCKER_PATH_RULES: readonly string[] = [
  '/analytics/event', // EasyPrivacy, generic — what blocked the web uploads
  '/analytics/track',
  '/analytics.',
  '/analytics?',
  '/track/',
  '/tracking/',
  '/tracker',
  '/telemetry',
  '/collect?',
  '/beacon',
  '/pixel',
  '/stats/event',
  '/log/event',
  '/events/track',
];

/** Rules from BLOCKER_PATH_RULES that `path` would trip ([] = safe). */
export function analyticsUploadPathProblems(path: string): string[] {
  const p = path.toLowerCase();
  return BLOCKER_PATH_RULES.filter((rule) => p.includes(rule));
}

export interface UsageEventInput {
  /** Client-made unique id (dedupe key). */
  id: string;
  /** When it happened on the device (ISO 8601). */
  ts: string;
  event: string;
  /** Route pattern of the screen it happened on (screenName()). */
  screen?: string | null;
  props?: AnalyticsProps;
  session_id: string;
  platform: AnalyticsPlatform;
  app_version?: string | null;
}

export interface UsageEventRow {
  id: string;
  ts: string;
  event: string;
  screen: string | null;
  props: AnalyticsProps;
  session_id: string | null;
  platform: AnalyticsPlatform;
  app_version: string | null;
}

export const MAX_EVENTS_PER_UPLOAD = 500;
/** Device clocks drift; events claiming to be from further ahead than this are clamped to now. */
const MAX_FUTURE_MS = 10 * 60 * 1000;
/** Older than this (queued offline for months?) is still kept, just not older than retention. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const ID_RE = /^[A-Za-z0-9_.:-]{8,80}$/;

/** Validates an upload body. Pure: `now` is passed in. */
export function parseUsageUpload(body: unknown, now: number): { events: UsageEventRow[]; rejected: number } | { error: string } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { events?: unknown }).events)) {
    return { error: '`events` must be an array' };
  }
  const raw = (body as { events: unknown[] }).events;
  if (raw.length > MAX_EVENTS_PER_UPLOAD) return { error: `At most ${MAX_EVENTS_PER_UPLOAD} events per upload` };
  const events: UsageEventRow[] = [];
  let rejected = 0;
  for (const item of raw) {
    const row = parseOne(item, now);
    if (row) events.push(row);
    else rejected++;
  }
  return { events, rejected };
}

function parseOne(item: unknown, now: number): UsageEventRow | null {
  if (!item || typeof item !== 'object') return null;
  const x = item as Record<string, unknown>;
  if (typeof x.id !== 'string' || !ID_RE.test(x.id)) return null;
  if (!isClientEvent(x.event)) return null;
  const platform = (ANALYTICS_PLATFORMS as readonly string[]).includes(x.platform as string) ? (x.platform as AnalyticsPlatform) : null;
  if (!platform) return null;
  let t = typeof x.ts === 'string' ? Date.parse(x.ts) : typeof x.ts === 'number' ? x.ts : NaN;
  if (!Number.isFinite(t)) return null;
  if (t > now + MAX_FUTURE_MS) t = now;
  if (t < now - MAX_AGE_MS) return null;
  const session = typeof x.session_id === 'string' && isSafeToken(x.session_id) ? x.session_id : null;
  const version = typeof x.app_version === 'string' && x.app_version.length <= 40 && /^[A-Za-z0-9_.:+() -]+$/.test(x.app_version) ? x.app_version : null;
  const screen = typeof x.screen === 'string' && x.screen ? screenName(x.screen).slice(0, 120) : null;
  return {
    id: x.id,
    ts: new Date(t).toISOString(),
    event: x.event,
    screen,
    props: sanitizeProps(x.event, x.props),
    session_id: session,
    platform,
    app_version: version,
  };
}
