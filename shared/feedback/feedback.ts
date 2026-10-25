/**
 * In-app feedback (docs/FEEDBACK.md): "something's wrong / I have an idea", sent from anywhere in
 * the apps — the web's Send feedback sheet (More, Settings, Shift+?, a phone shake), the Lab app's
 * shake-to-report sheet, the VR front end — to `POST /api/feedback`, which stores it as a
 * `feature_requests` row (kind feedback | bug) so the admin page and the MCP feature-request tools
 * see it like any other request.
 *
 * This file is the ONE definition of what a feedback item may carry. The context is diagnostic
 * only: platform, app version, the screen's ROUTE PATTERN, install kind, device model, online
 * state, viewport and the names of the last few analytics events. Never card content, answers,
 * messages, tokens or URLs with query strings — `pickFeedbackContext` drops anything else, on the
 * device and again on the server.
 */

/** Where the feedback was sent from (web = browser / PWA / hybrid shell; lab = the native app). */
export const FEEDBACK_PLATFORMS = ['web', 'lab', 'vr', 'desktop'] as const;
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number];

/** feedback = an idea / a remark; bug = something is wrong. */
export const FEEDBACK_KINDS = ['feedback', 'bug'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** How the sheet was opened (analytics `feedback.open { via }`). */
export const FEEDBACK_VIAS = ['shake', 'menu', 'shortcut', 'vr', 'fab', 'settings'] as const;
export type FeedbackVia = (typeof FEEDBACK_VIAS)[number];

export const FEEDBACK_MAX_MESSAGE = 4000;
export const FEEDBACK_MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const FEEDBACK_MAX_CONSOLE_LOGS = 50_000;
/** How many recent analytics event names ride along. */
export const FEEDBACK_RECENT_EVENTS = 15;
/** Per account: feedback items accepted in one rolling hour (the server answers 429 after that). */
export const FEEDBACK_PER_HOUR = 20;

export interface FeedbackContext {
  platform?: FeedbackPlatform;
  app_version?: string;
  /** The screen's route pattern (`/decks/:id`), never a query string. */
  screen?: string;
  install_kind?: string;
  /** Device model ("Pixel 10 Pro Fold"). */
  device?: string;
  /** OS / browser in a few words ("Android 16", "Chrome 141"). */
  os?: string;
  online?: boolean;
  /** "412x915" (CSS px / dp). */
  viewport?: string;
  via?: FeedbackVia;
  /** Names of the last analytics events (`study.card_rated`), oldest first. */
  recent_events?: string[];
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._+:()\-/]*$/;
const EVENT = /^[a-z_]+\.[a-z0-9_.]+$/;

function shortText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s && TOKEN.test(s) ? s : undefined;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * A path → its route pattern: segments that read like route words (`decks`, `homework-library`) are
 * kept, anything else (ids, hanzi, dates) becomes `:id`; the query string and hash are dropped.
 */
export function routePattern(path: string): string {
  const clean = path.replace(/[?#].*$/, '').trim();
  if (!clean.startsWith('/')) return '/';
  const segs = clean.split('/').filter(Boolean).slice(0, 8);
  if (segs.length === 0) return '/';
  return '/' + segs.map((s) => (s.startsWith(':') || /^[a-z][a-z-]{0,39}$/.test(s) ? s : ':id')).join('/');
}

/** The context with every unknown key and every value that isn't a short token / enum dropped. */
export function pickFeedbackContext(raw: unknown): FeedbackContext {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: FeedbackContext = {};
  const platform = oneOf(src.platform, FEEDBACK_PLATFORMS);
  if (platform) out.platform = platform;
  const version = shortText(src.app_version, 40);
  if (version) out.app_version = version;
  if (typeof src.screen === 'string' && src.screen.trim()) out.screen = routePattern(src.screen.slice(0, 300));
  const install = shortText(src.install_kind, 30);
  if (install) out.install_kind = install;
  const device = shortText(src.device, 80);
  if (device) out.device = device;
  const os = shortText(src.os, 40);
  if (os) out.os = os;
  if (typeof src.online === 'boolean') out.online = src.online;
  if (typeof src.viewport === 'string' && /^\d{2,5}x\d{2,5}$/.test(src.viewport)) out.viewport = src.viewport;
  const via = oneOf(src.via, FEEDBACK_VIAS);
  if (via) out.via = via;
  if (Array.isArray(src.recent_events)) {
    const events = src.recent_events.filter((e): e is string => typeof e === 'string' && e.length <= 60 && EVENT.test(e));
    if (events.length) out.recent_events = events.slice(-FEEDBACK_RECENT_EVENTS);
  }
  return out;
}

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return oneOf(v, FEEDBACK_KINDS) !== undefined;
}

const PLATFORM_LABEL: Record<FeedbackPlatform, string> = { web: 'Web', lab: 'Lab app', vr: 'VR', desktop: 'Desktop' };

/** One line for lists: "Lab app 0.142 · /study · Pixel 10 Pro Fold · offline". */
export function feedbackContextLine(ctx: FeedbackContext | null | undefined): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.platform) parts.push(ctx.app_version ? `${PLATFORM_LABEL[ctx.platform]} ${ctx.app_version}` : PLATFORM_LABEL[ctx.platform]);
  else if (ctx.app_version) parts.push(ctx.app_version);
  if (ctx.screen) parts.push(ctx.screen);
  if (ctx.device) parts.push(ctx.device);
  else if (ctx.os) parts.push(ctx.os);
  if (ctx.online === false) parts.push('offline');
  if (ctx.via === 'shake') parts.push('shaken');
  return parts.join(' · ');
}

/** What the feature-request row's `content` holds: the message, or a placeholder for a screenshot alone. */
export function feedbackContent(message: string, hasScreenshot: boolean, kind: FeedbackKind): string {
  const m = message.trim();
  if (m) return m;
  if (hasScreenshot) return kind === 'bug' ? '(Something looks wrong — screenshot only, no message)' : '(Screenshot only, no message)';
  return '';
}

export type FeedbackProblem = 'empty' | 'too_long' | 'kind';

/** Why a feedback item can't be sent ([] = fine). A screenshot alone is enough. */
export function feedbackProblems(input: { message: string; hasScreenshot: boolean; kind?: unknown }): FeedbackProblem[] {
  const out: FeedbackProblem[] = [];
  if (!input.message.trim() && !input.hasScreenshot) out.push('empty');
  if (input.message.length > FEEDBACK_MAX_MESSAGE) out.push('too_long');
  if (input.kind !== undefined && !isFeedbackKind(input.kind)) out.push('kind');
  return out;
}

export const FEEDBACK_COPY = {
  title: 'Send feedback',
  bugChip: '🐛 Something’s wrong',
  ideaChip: '💡 Idea',
  placeholder: 'What happened, or what would make it better?',
  screenshotOn: 'Include screenshot',
  screenshotNote: 'The screenshot shows what was on your screen. Only you and the app’s admin can see it.',
  sent: 'Thanks — sent.',
  queued: 'Saved — it will be sent when you’re back online.',
  shakeSetting: 'Shake to send feedback',
} as const;
