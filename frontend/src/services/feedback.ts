/**
 * In-app feedback on the web (docs/FEEDBACK.md): the Send feedback sheet hands what was written (+ the
 * screenshot, + opt-in console logs) to `queueFeedback`, which keeps it in its own small IndexedDB
 * (`feedback-outbox`, blobs included) and posts it to `POST /api/feedback` — at once when online, else
 * when the browser comes back online and on every sync (`flushFeedback`). The server is idempotent by
 * `client_id`, so a retry after a lost response never makes a second item.
 *
 * `feedbackContext` builds the diagnostic context (shared/feedback `pickFeedbackContext` decides what
 * may go): platform, build, the screen's route pattern, install kind, browser, online, viewport, how
 * the sheet was opened and the names of the last analytics events. Never the page's content.
 */
import Dexie, { type Table } from 'dexie';
import { API_PATH, getAuthHeaders } from '../api/client';
import { BUILD_TIME } from '../utils/appUpdates';
import { detectInstallKind } from './clientState';
import { currentScreenPattern, recentEventNames } from './analytics';
import { getDesktopBridge } from '@shared/desktop/bridge';
import { pickFeedbackContext, routePattern, type FeedbackContext, type FeedbackKind, type FeedbackVia } from '@shared/feedback';

export interface QueuedFeedback {
  client_id: string;
  message: string;
  kind: FeedbackKind;
  context: FeedbackContext;
  console_logs?: string | null;
  screenshot?: Blob | null;
  /** The screenshot's type, kept apart (some stores drop a Blob's type). */
  screenshot_type?: string | null;
  created_at: string;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string | null;
}

class FeedbackDb extends Dexie {
  items!: Table<QueuedFeedback, string>;
  constructor() {
    super('feedback-outbox');
    this.version(1).stores({ items: 'client_id, created_at, status' });
  }
}

let db: FeedbackDb | null = null;
function fdb(): FeedbackDb {
  if (!db) db = new FeedbackDb();
  return db;
}

function newClientId(): string {
  try {
    return `fb_${crypto.randomUUID().replace(/-/g, '')}`;
  } catch {
    return `fb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  }
}

function browserLabel(): string | undefined {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const m = ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/);
  const browser = m ? `${m[1] === 'Version' ? 'Safari' : m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}` : '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' ') || undefined;
}

/** What rides along with a feedback item from this page. */
export function feedbackContext(via: FeedbackVia, path: string): FeedbackContext {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return pickFeedbackContext({
    platform: getDesktopBridge() ? 'desktop' : 'web',
    // The web's version is its build time (ISO): "2026-10-25 23:27".
    app_version: BUILD_TIME && BUILD_TIME !== 'unknown' ? String(BUILD_TIME).slice(0, 16).replace('T', ' ') : undefined,
    screen: currentScreenPattern() ?? routePattern(path),
    install_kind: detectInstallKind(),
    os: browserLabel(),
    online: nav ? nav.onLine !== false : undefined,
    viewport: typeof window !== 'undefined' ? `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}` : undefined,
    via,
    recent_events: recentEventNames(),
  });
}

export interface FeedbackDraft {
  message: string;
  kind: FeedbackKind;
  context: FeedbackContext;
  consoleLogs?: string | null;
  screenshot?: Blob | null;
}

/** Saves the item and tries to send it now. `sent` false = queued (offline / the server is busy). */
export async function queueFeedback(draft: FeedbackDraft): Promise<{ sent: boolean; client_id: string }> {
  const item: QueuedFeedback = {
    client_id: newClientId(),
    message: draft.message.trim(),
    kind: draft.kind,
    context: draft.context,
    console_logs: draft.consoleLogs ?? null,
    screenshot: draft.screenshot ?? null,
    screenshot_type: draft.screenshot?.type || null,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  };
  try {
    await fdb().items.put(item);
  } catch {
    // No IndexedDB (private window): send directly, nothing to retry from.
    const res = await postFeedback(item).catch(() => null);
    if (res && res.ok) return { sent: true, client_id: item.client_id };
    throw new Error(res ? await errorText(res) : 'Could not send feedback — check your connection');
  }
  const out = await flushFeedback();
  return { sent: out.sentIds.includes(item.client_id), client_id: item.client_id };
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function postFeedback(item: QueuedFeedback): Promise<Response> {
  const form = new FormData();
  form.set('client_id', item.client_id);
  form.set('message', item.message);
  form.set('kind', item.kind);
  form.set('context', JSON.stringify(item.context));
  if (item.console_logs) form.set('console_logs', item.console_logs);
  if (item.screenshot) {
    const type = item.screenshot_type || item.screenshot.type || 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    form.set('screenshot', new File([item.screenshot], `screenshot.${ext}`, { type }));
  }
  return fetch(`${API_PATH}/feedback`, { method: 'POST', headers: getAuthHeaders(), body: form, credentials: 'include' });
}

const MAX_ATTEMPTS = 8;
let flushing: Promise<{ sent: number; sentIds: string[]; remaining: number }> | null = null;

/** Sends what is queued, oldest first; stops at the first network error. Never throws. */
export function flushFeedback(): Promise<{ sent: number; sentIds: string[]; remaining: number }> {
  if (flushing) return flushing.then(() => flushFeedback());
  flushing = (async () => {
    const sentIds: string[] = [];
    try {
      const items = (await fdb().items.orderBy('created_at').toArray()).filter((i) => i.status === 'pending');
      for (const item of items) {
        let res: Response;
        try {
          res = await postFeedback(item);
        } catch {
          break; // offline: keep the order, try again later
        }
        if (res.ok) {
          await fdb().items.delete(item.client_id);
          sentIds.push(item.client_id);
          continue;
        }
        const attempts = item.attempts + 1;
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500 || res.status === 401;
        await fdb().items.update(item.client_id, {
          attempts,
          status: retryable && attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
          error: await errorText(res),
        });
        if (retryable) break;
      }
      const remaining = await fdb().items.where('status').equals('pending').count();
      return { sent: sentIds.length, sentIds, remaining };
    } catch {
      return { sent: sentIds.length, sentIds, remaining: 0 };
    }
  })();
  const p = flushing;
  void p.finally(() => {
    if (flushing === p) flushing = null;
  });
  return p;
}

/** How many items are waiting for a connection. */
export async function pendingFeedbackCount(): Promise<number> {
  try {
    return await fdb().items.where('status').equals('pending').count();
  } catch {
    return 0;
  }
}

// ── Shake to send feedback (phones; docs/FEEDBACK.md) ──────────────────────

const SHAKE_KEY = 'feedback-shake-v1';

/**
 * Can this browser report a shake without asking? Android Chrome fires `devicemotion` freely; iOS
 * Safari needs `DeviceMotionEvent.requestPermission()` from a tap, so the switch isn't offered there.
 */
export function shakeSupported(): boolean {
  if (typeof window === 'undefined' || typeof (window as unknown as { DeviceMotionEvent?: unknown }).DeviceMotionEvent === 'undefined') return false;
  const DME = (window as unknown as { DeviceMotionEvent: { requestPermission?: unknown } }).DeviceMotionEvent;
  if (typeof DME.requestPermission === 'function') return false;
  // Phones and tablets only (a laptop has no accelerometer worth listening to).
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** "Shake to send feedback" (Settings, per device; on by default where supported). */
export function isShakeEnabled(): boolean {
  try {
    return localStorage.getItem(SHAKE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setShakeEnabled(on: boolean): void {
  try {
    localStorage.setItem(SHAKE_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('feedback-shake-changed'));
}

/** Pages where a shake never opens the sheet: a call (the phone moves around), the group class. */
export function shakeBlockedOn(path: string): boolean {
  return /^\/(calls|group-class)\/[^/]+/.test(path);
}

export async function __clearFeedbackForTests(): Promise<void> {
  await fdb().items.clear();
}
