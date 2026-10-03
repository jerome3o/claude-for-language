/**
 * Push notifications to a user's browsers / installed PWA (Web Push).
 *
 * Keys: the VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets when set; otherwise a
 * key pair is generated once and kept in `app_keys`, so push works without any
 * setup. Each subscription remembers the key it was made with; the client
 * re-subscribes when the server's key changes (GET /api/push/config).
 */

import type { Env } from '../../types';
import { trackServer } from '../analytics/server-events';
import { generateId } from '../cards';
import { generateVapidKeys, sendWebPush, type PushOptions, type VapidKeys } from './webpush';

export type CallAlertsMode = 'ring' | 'silent';

export function normalizeCallAlerts(value: unknown): CallAlertsMode {
  return value === 'silent' ? 'silent' : 'ring';
}

export async function getVapidKeys(env: Env): Promise<VapidKeys> {
  const subject = env.VAPID_SUBJECT?.trim() || (env.ADMIN_EMAIL ? `mailto:${env.ADMIN_EMAIL}` : 'mailto:admin@chinese-learning.app');
  if (env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim()) {
    return { publicKey: env.VAPID_PUBLIC_KEY.trim(), privateKey: env.VAPID_PRIVATE_KEY.trim(), subject };
  }
  const read = async () => {
    const row = await env.DB.prepare("SELECT value FROM app_keys WHERE name = 'vapid'").first<{ value: string }>();
    return row ? (JSON.parse(row.value) as { publicKey: string; privateKey: string }) : null;
  };
  let stored = await read();
  if (!stored) {
    const fresh = await generateVapidKeys();
    // Two first requests at once: whichever insert wins is the key everyone uses.
    await env.DB.prepare("INSERT OR IGNORE INTO app_keys (name, value) VALUES ('vapid', ?)").bind(JSON.stringify(fresh)).run();
    stored = (await read()) ?? fresh;
  }
  return { ...stored, subject };
}

export interface SubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
}

export class PushError extends Error {
  constructor(public status: 400 | 404, message: string) {
    super(message);
  }
}

/** Store (or move to this user) a browser's subscription. Idempotent by endpoint. */
export async function saveSubscription(env: Env, userId: string, input: SubscriptionInput, userAgent: string | null): Promise<{ id: string }> {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  const p256dh = typeof input.keys?.p256dh === 'string' ? input.keys.p256dh : '';
  const auth = typeof input.keys?.auth === 'string' ? input.keys.auth : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) throw new PushError(400, 'endpoint must be an https URL');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new PushError(400, 'keys.p256dh and keys.auth are required');
  const keys = await getVapidKeys(env);
  const id = generateId();
  await env.DB
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, vapid_key, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         vapid_key = excluded.vapid_key, user_agent = excluded.user_agent, failure_count = 0`,
    )
    .bind(id, userId, endpoint, p256dh, auth, keys.publicKey, userAgent?.slice(0, 300) ?? null)
    .run();
  const row = await env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<{ id: string }>();
  return { id: row?.id ?? id };
}

export async function deleteSubscription(env: Env, userId: string, endpoint: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

export async function countSubscriptions(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** A subscription that fails this many times in a row (not 404/410) is dropped. */
const MAX_FAILURES = 5;

export interface PushSummary {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Send `data` to every subscription of these users. Dead subscriptions are
 * deleted; one made with an old key is dropped (the device re-subscribes).
 */
/** The `type` of a push payload, for analytics (an enum, never content). */
export function pushKind(data: unknown): string {
  const t = data && typeof data === 'object' ? (data as { type?: unknown }).type : null;
  return typeof t === 'string' ? t : 'other';
}

export async function pushToUsers(env: Env, userIds: string[], data: unknown, opts: PushOptions = {}, fetcher?: typeof fetch): Promise<PushSummary> {
  const summary: PushSummary = { sent: 0, failed: 0, removed: 0 };
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return summary;
  const rows = await env.DB
    .prepare(`SELECT id, user_id, endpoint, p256dh, auth, vapid_key, failure_count FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string; vapid_key: string; failure_count: number }>();
  const subs = rows.results ?? [];
  if (subs.length === 0) return summary;
  const keys = await getVapidKeys(env);
  await Promise.all(
    subs.map(async (sub) => {
      if (sub.vapid_key !== keys.publicKey) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        summary.removed++;
        return;
      }
      const r = await sendWebPush(sub, data, keys, opts, fetcher);
      void trackServer('server.push_sent', { channel: 'web', kind: pushKind(data), ok: r.ok }, { env, userId: sub.user_id });
      if (r.ok) {
        summary.sent++;
        await env.DB.prepare("UPDATE push_subscriptions SET last_success_at = datetime('now'), failure_count = 0 WHERE id = ?").bind(sub.id).run();
      } else if (r.gone || sub.failure_count + 1 >= MAX_FAILURES) {
        summary.removed++;
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
      } else {
        summary.failed++;
        console.warn('[push] failed', r.status, r.error);
        await env.DB.prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?').bind(sub.id).run();
      }
    }),
  );
  return summary;
}
