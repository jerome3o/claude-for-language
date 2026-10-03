/**
 * The privacy filter every usage event goes through — on the device before it is
 * queued AND on the server before it is stored (docs/ANALYTICS.md).
 *
 * Rule: ids, enums, counts, durations and booleans only. Never message text,
 * card content, typed answers, recordings, transcripts, tokens, URLs or e-mail
 * addresses. Enforced by
 *   1. an allow-list: a prop key not declared for the event in the catalogue is dropped;
 *   2. a deny-list of keys that may never appear, even if someone adds them to the catalogue
 *      (events.test.ts checks the catalogue against it);
 *   3. value shapes: finite numbers, booleans, null, and strings that are a short
 *      id / enum token (letters, digits, `_ - . : /`, ≤ 64 chars) — no spaces, no
 *      `@`, no Chinese, so a sentence, an address or a name can never pass.
 * Ported to Kotlin as AnalyticsPrivacy.kt (parity-tested).
 */
import { ANALYTICS_EVENTS, isAnalyticsEvent, type AnalyticsEventDef } from './events';

export type AnalyticsPropValue = string | number | boolean | null;
export type AnalyticsProps = Record<string, AnalyticsPropValue>;

/** Keys that can never be a prop, whatever the catalogue says. */
export const FORBIDDEN_PROP_KEYS: readonly string[] = [
  'text', 'content', 'body', 'message', 'answer', 'typed', 'hanzi', 'pinyin', 'english', 'translation',
  'transcript', 'recording', 'audio', 'email', 'token', 'password', 'secret', 'name', 'title', 'url',
  'query', 'q', 'prompt', 'notes', 'comment', 'sentence', 'fun_facts',
];

export const MAX_PROP_STRING = 64;
export const MAX_PROPS = 12;
const TOKEN_RE = /^[A-Za-z0-9_.:/-]+$/;

/** A string that is safe to keep: a short id / enum token. */
export function isSafeToken(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PROP_STRING && TOKEN_RE.test(value);
}

/**
 * Keeps only the props the catalogue allows for `event`, with safe values.
 * Unknown events get no props at all. Pure.
 */
export function sanitizeProps(event: string, props: unknown): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!isAnalyticsEvent(event) || !props || typeof props !== 'object' || Array.isArray(props)) return out;
  const allowed = (ANALYTICS_EVENTS[event] as AnalyticsEventDef).props;
  let n = 0;
  for (const key of allowed) {
    if (n >= MAX_PROPS) break;
    if (FORBIDDEN_PROP_KEYS.includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
    const v = (props as Record<string, unknown>)[key];
    if (v === null || typeof v === 'boolean') {
      out[key] = v;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      out[key] = Math.round(v * 1e6) / 1e6;
    } else if (typeof v === 'string') {
      if (!isSafeToken(v)) continue;
      out[key] = v;
    } else {
      continue;
    }
    n++;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path segment that is an id rather than part of the route's shape. */
export function isIdSegment(seg: string): boolean {
  if (!seg) return false;
  if (UUID_RE.test(seg)) return true;
  if (/^\d+$/.test(seg)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return true;
  // Mixed letters + digits, 8+ long (nanoid / hex / base64url ids); words like "v2" stay.
  if (seg.length >= 8 && /\d/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg)) return true;
  // Anything that is not a plain lowercase route word (encoded text, Chinese, e-mails…).
  return !/^[a-z][a-z0-9-]*$/.test(seg);
}

/**
 * The screen name of a path: the route pattern with ids replaced by `:id`,
 * no query or hash. `/connections/abc123def456/chat/xyz98765` →
 * `/connections/:id/chat/:id`. Lab routes written with `{id}` map the same way. Pure.
 */
export function screenName(path: string): string {
  const clean = (path || '/').split(/[?#]/)[0] || '/';
  const segs = clean.split('/').filter(Boolean).map((s) => (/^\{.+\}$/.test(s) || s.startsWith(':') ? ':id' : isIdSegment(s) ? ':id' : s));
  return segs.length ? `/${segs.join('/')}` : '/';
}
