/**
 * Usage analytics for the web app (docs/ANALYTICS.md): screen views and the
 * feature events in the shared catalogue (shared/analytics/events.ts), queued in
 * their own small IndexedDB and uploaded in batches during sync and every ~60 s
 * while online. The Lab app does the same (android-lab …/data/analytics/).
 *
 * PRIVACY RULE — ids, enums, counts, durations and booleans ONLY. Never message
 * text, card content, typed answers, recordings, transcripts, tokens, URLs or
 * e-mail addresses. Every prop goes through `sanitizeProps` before it is queued
 * (a key the catalogue doesn't list for that event is dropped, and so is any
 * string that isn't a short id / enum token); the server filters again.
 *
 * Analytics must never break or slow anything: `track` returns at once, every
 * storage / network step is wrapped in try/catch, nothing here throws.
 */
import Dexie, { type Table } from 'dexie';
import {
  isClientEvent,
  sanitizeProps,
  screenName,
  type AnalyticsEventName,
  type AnalyticsPlatform,
  type AnalyticsProps,
} from '@shared/analytics';
import { API_BASE, getAuthHeaders } from '../api/client';
import { BUILD_TIME } from '../utils/appUpdates';
import { detectInstallKind } from './clientState';

export interface QueuedEvent {
  id: string;
  ts: string;
  event: string;
  screen: string | null;
  props: AnalyticsProps;
  session_id: string;
  platform: AnalyticsPlatform;
  app_version: string | null;
}

class AnalyticsDb extends Dexie {
  events!: Table<QueuedEvent, string>;
  constructor() {
    super('usage-analytics');
    this.version(1).stores({ events: 'id' });
  }
}

let dbInstance: AnalyticsDb | null = null;
function adb(): AnalyticsDb {
  if (!dbInstance) dbInstance = new AnalyticsDb();
  return dbInstance;
}

export const MAX_QUEUE = 5000;
export const UPLOAD_BATCH = 500;
export const SESSION_GAP_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60 * 1000;
const PREF_KEY = 'analytics-share-usage';

/** Every queue write / clear runs in order on this chain. */
let pending: Promise<void> = Promise.resolve();
let writesSinceTrim = 0;
const SESSION_KEY = 'analytics-session';

// ─── preference ────────────────────────────────────────────────────────────

export function isSharingUsage(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Applies the server's `share_usage` (from /api/auth/me) or the Settings switch. Off clears the queue. */
export function setSharingUsage(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // private mode
  }
  if (!on) void clearAnalyticsQueue();
}

/** Empties the queue — after any write still in flight, so nothing slips in behind it. */
export function clearAnalyticsQueue(): Promise<void> {
  pending = pending.then(async () => {
    try {
      await adb().events.clear();
    } catch {
      // ignore
    }
  });
  return pending;
}

// ─── context ───────────────────────────────────────────────────────────────

export function analyticsPlatform(): AnalyticsPlatform {
  const kind = detectInstallKind();
  return kind === 'android' ? 'android-hybrid' : kind === 'pwa' ? 'pwa' : 'web';
}

function randomId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

let seq = 0;
/** Sortable within a millisecond (time, then a counter), unique across devices (random tail). */
function eventId(): string {
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `e_${now().toString(36).padStart(9, '0')}${(seq++ % 1679616).toString(36).padStart(4, '0')}_${rand}`;
}

let memorySession: { id: string; last: number } | null = null;
let now: () => number = () => Date.now();

/** The current analytics session; a new one after SESSION_GAP_MS of inactivity (emits app.open). */
function sessionId(): string {
  const t = now();
  let s = memorySession;
  if (!s) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) s = JSON.parse(raw);
    } catch {
      s = null;
    }
  }
  let fresh = false;
  if (!s || typeof s.id !== 'string' || !(t - s.last < SESSION_GAP_MS)) {
    s = { id: randomId('s'), last: t };
    fresh = true;
  }
  s.last = t;
  memorySession = s;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
  if (fresh) enqueue('app.open', { install_kind: detectInstallKind() }, s.id);
  return s.id;
}

// ─── recording ─────────────────────────────────────────────────────────────

let currentScreen: { name: string; since: number } | null = null;

function enqueue(event: AnalyticsEventName, props: Record<string, unknown> | undefined, session: string): void {
  const row: QueuedEvent = {
    id: eventId(),
    ts: new Date(now()).toISOString(),
    event,
    screen: currentScreen?.name ?? null,
    props: sanitizeProps(event, props ?? {}),
    session_id: session,
    platform: analyticsPlatform(),
    app_version: BUILD_TIME,
  };
  pending = pending.then(async () => {
    try {
      await adb().events.put(row);
      if (++writesSinceTrim >= 200) {
        writesSinceTrim = 0;
        await trimQueue();
      }
    } catch {
      // IndexedDB unavailable: drop the event, never the app
    }
  });
}


async function trimQueue(): Promise<void> {
  const count = await adb().events.count();
  if (count <= MAX_QUEUE) return;
  const oldest = await adb().events.orderBy('id').limit(count - MAX_QUEUE).primaryKeys();
  await adb().events.bulkDelete(oldest);
}

/**
 * Records one catalogue event. Unknown names are ignored. Props are filtered by
 * the privacy rule before anything is stored. Never throws, never awaits.
 */
export function track(event: AnalyticsEventName, props?: Record<string, unknown>): void {
  try {
    if (!isSharingUsage() || !isClientEvent(event)) return;
    enqueue(event, props, sessionId());
  } catch {
    // never
  }
}

/** Records an error message shown to the user: where + a short code / HTTP status, never the message. */
export function trackError(where: string, err: unknown): void {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : null;
  const name = err instanceof Error ? err.name : typeof err === 'string' ? 'message' : 'unknown';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  track('error.shown', { where, status, code: offline ? 'offline' : status ? `http_${status}` : name });
}

/**
 * The router calls this on every location change: closes the screen being
 * left (`app.screen_view` with its time on screen) and opens the new one.
 */
export function trackScreen(path: string): void {
  try {
    const name = screenName(path);
    if (currentScreen?.name === name) return;
    closeScreen();
    currentScreen = { name, since: now() };
  } catch {
    // never
  }
}

function closeScreen(): void {
  if (!currentScreen) return;
  const duration = now() - currentScreen.since;
  if (duration >= 300 && isSharingUsage()) {
    try {
      const session = sessionId();
      // screen = the screen being LEFT (enqueue reads currentScreen)
      enqueue('app.screen_view', { duration_ms: duration }, session);
    } catch {
      // never
    }
  }
}

function onVisibility(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    const name = currentScreen?.name;
    closeScreen();
    currentScreen = name ? { name, since: Number.POSITIVE_INFINITY } : null;
    void flushAnalytics({ keepalive: true });
  } else if (currentScreen) {
    currentScreen = { name: currentScreen.name, since: now() };
  }
}

// ─── upload ────────────────────────────────────────────────────────────────

let flushing: Promise<{ sent: number }> | null = null;

/** Uploads queued events in batches. Deleted only after a 2xx (or a permanent 4xx). */
export function flushAnalytics(opts: { keepalive?: boolean } = {}): Promise<{ sent: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    try {
      await pending;
      if (!isSharingUsage()) {
        await clearAnalyticsQueue();
        return { sent };
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent };
      for (let round = 0; round < 10; round++) {
        const batch = await adb().events.orderBy('id').limit(UPLOAD_BATCH).toArray();
        if (!batch.length) break;
        let res: Response;
        try {
          res = await fetch(`${API_BASE}/api/analytics/events`, {
            method: 'POST',
            credentials: 'include',
            keepalive: opts.keepalive && batch.length < 100,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ events: batch }),
          });
        } catch {
          break; // offline / network: keep for next time
        }
        if (res.ok) {
          await adb().events.bulkDelete(batch.map((e) => e.id));
          sent += batch.length;
          try {
            const body = (await res.json()) as { opted_out?: boolean };
            if (body.opted_out) setSharingUsage(false);
          } catch {
            // ignore
          }
          if (batch.length < UPLOAD_BATCH) break;
          continue;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
          await adb().events.bulkDelete(batch.map((e) => e.id)); // will never succeed
        }
        break;
      }
    } catch (err) {
      console.warn('[analytics] flush failed:', err instanceof Error ? err.message : err);
    }
    return { sent };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let started = false;

/** Called once at app start: periodic upload while online, screen time on hide. */
export function startAnalytics(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    window.setInterval(() => {
      if (navigator.onLine !== false) void flushAnalytics();
    }, FLUSH_INTERVAL_MS);
    window.addEventListener('online', () => void flushAnalytics());
    document.addEventListener('visibilitychange', onVisibility);
  } catch {
    // never
  }
}

/** Test hooks. */
export async function __analyticsQueueForTests(): Promise<QueuedEvent[]> {
  await pending;
  return adb().events.orderBy('id').toArray();
}
export function __resetAnalyticsForTests(clock?: () => number): void {
  now = clock ?? (() => Date.now());
  memorySession = null;
  currentScreen = null;
  flushing = null;
  writesSinceTrim = 0;
}
