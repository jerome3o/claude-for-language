/**
 * Web Push for call alerts: when someone starts a call and this browser / the
 * installed PWA isn't open, the service worker (public/push-sw.js) shows
 * "📹 <name> is calling" and a tap opens the call.
 *
 * The server's VAPID key comes from GET /api/push/config; a subscription made
 * with an older key is replaced (refreshPushSubscription, run after sign-in).
 */

import { API_BASE, getAuthHeaders } from '../api/client';

export type CallAlertsMode = 'ring' | 'silent';
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

interface PushConfig {
  public_key: string;
  call_alerts: CallAlertsMode;
  subscriptions: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getPushConfig = () => api<PushConfig>('/push/config');

export async function setCallAlerts(mode: CallAlertsMode): Promise<CallAlertsMode> {
  const r = await api<{ call_alerts: CallAlertsMode }>('/profile/call-alerts', { method: 'PUT', body: JSON.stringify({ call_alerts: mode }) });
  rememberCallAlerts(r.call_alerts);
  return r.call_alerts;
}

/** Chat e-mails on / off for the account (push notifications are separate). */
export async function setChatEmails(on: boolean): Promise<boolean> {
  const r = await api<{ email_chat_messages: boolean }>('/profile/email-prefs', { method: 'PUT', body: JSON.stringify({ email_chat_messages: on }) });
  return r.email_chat_messages;
}

const MODE_KEY = 'call-alerts-mode';

/** The account's setting, mirrored on the device so the ring decision works before /auth/me answers. */
export function callAlertsMode(): CallAlertsMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'silent' ? 'silent' : 'ring';
  } catch {
    return 'ring';
  }
}

export function rememberCallAlerts(mode: CallAlertsMode | null | undefined): void {
  try {
    localStorage.setItem(MODE_KEY, mode === 'silent' ? 'silent' : 'ring');
  } catch {
    /* private mode */
  }
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The service worker registration, or null (dev server, blocked, or too slow). */
async function registration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (existing?.active) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await registration(1500);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

async function upload(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await api('/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
}

async function subscribe(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) as BufferSource });
}

/**
 * Ask for permission (must run from a tap) and subscribe this browser.
 * Returns a sentence for the UI when it can't.
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: 'This browser can’t show notifications. On a phone, install the app to the home screen first.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: permission === 'denied' ? 'Notifications are blocked for this site — allow them in the browser’s site settings.' : 'Notifications were not allowed.' };
  }
  const reg = await registration();
  if (!reg) return { ok: false, reason: 'The app’s background worker isn’t running yet — reload the page and try again.' };
  try {
    const { public_key } = await getPushConfig();
    let sub = await reg.pushManager.getSubscription();
    if (sub && bytesToB64url(sub.options.applicationServerKey) !== public_key) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub = sub ?? (await subscribe(reg, public_key));
    await upload(sub);
    markSynced();
    setTurnedOff(false);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not turn on notifications.' };
  }
}

const OFF_KEY = 'push-turned-off';
function setTurnedOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* ignore */
  }
}

export async function disablePush(): Promise<void> {
  setTurnedOff(true);
  const reg = await registration(1500);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await api('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export const sendTestPush = () => api<{ sent: number; failed: number; removed: number }>('/push/test', { method: 'POST' });

const SYNC_KEY = 'push-sub-synced-at';
function markSynced() {
  try {
    localStorage.setItem(SYNC_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * After sign-in (throttled to daily): when notifications are allowed, make
 * sure this browser's subscription exists, uses the server's current key and
 * is stored for this account (a shared computer may have switched accounts).
 */
export async function refreshPushSubscription(force = false): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    if (localStorage.getItem(OFF_KEY) === '1') return; // turned off in Settings on this device
    const last = Number(localStorage.getItem(SYNC_KEY) || 0);
    if (!force && Date.now() - last < 24 * 3600_000) return;
  } catch {
    /* ignore */
  }
  const reg = await registration();
  if (!reg) return;
  try {
    const { public_key, call_alerts } = await getPushConfig();
    rememberCallAlerts(call_alerts);
    let sub = await reg.pushManager.getSubscription();
    if (sub && bytesToB64url(sub.options.applicationServerKey) !== public_key) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) sub = await subscribe(reg, public_key);
    await upload(sub);
    markSynced();
  } catch (err) {
    console.warn('[push] refresh failed:', err);
  }
}

/** "Check my Chinese automatically" in the chat (docs/CHAT.md "Auto-check"); null = back to the default. */
export async function setChatAutoCheck(on: boolean | null): Promise<boolean | null> {
  const r = await api<{ chat_auto_check: boolean | null }>('/profile/chat-prefs', { method: 'PUT', body: JSON.stringify({ chat_auto_check: on }) });
  return r.chat_auto_check;
}
