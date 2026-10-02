/**
 * Native app push tokens (FCM registration tokens, `device_push_tokens`) and
 * sending to them (docs/CHAT.md §1–§3).
 */

import type { Env } from '../../types';
import { generateId } from '../cards';
import { fcmConfigured, sendFcm, type FcmSendOptions } from './fcm';

/** A token that fails this many times in a row (not "gone") is dropped. */
export const MAX_DEVICE_FAILURES = 5;

type DeviceEnv = Pick<Env, 'DB'> & { FCM_SERVICE_ACCOUNT_JSON?: string };

export class DeviceTokenError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface DeviceTokenInput {
  token?: unknown;
  platform?: unknown;
  app?: unknown;
  device_label?: unknown;
}

/** Store a device's token for this user (upsert by token: a token moving to another account moves with it). */
export async function saveDeviceToken(env: DeviceEnv, userId: string, input: DeviceTokenInput): Promise<{ id: string }> {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) throw new DeviceTokenError('token is required');
  const platform = input.platform === undefined || input.platform === null ? 'android' : input.platform;
  if (platform !== 'android') throw new DeviceTokenError("platform must be 'android'");
  const app = input.app === undefined || input.app === null ? 'lab' : input.app;
  if (typeof app !== 'string' || !/^[a-z][a-z0-9_-]{0,19}$/.test(app)) throw new DeviceTokenError('app is invalid');
  const label = typeof input.device_label === 'string' ? input.device_label.trim().slice(0, 100) || null : null;
  const id = generateId();
  await env.DB
    .prepare(
      `INSERT INTO device_push_tokens (id, user_id, token, platform, app, device_label)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, app = excluded.app,
         device_label = excluded.device_label, updated_at = datetime('now'), failure_count = 0`,
    )
    .bind(id, userId, token, platform, app, label)
    .run();
  const row = await env.DB.prepare('SELECT id FROM device_push_tokens WHERE token = ?').bind(token).first<{ id: string }>();
  return { id: row?.id ?? id };
}

export async function deleteDeviceToken(env: DeviceEnv, userId: string, token: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM device_push_tokens WHERE user_id = ? AND token = ?').bind(userId, token).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

/** A failure FCM answered about this message (not a network / credential problem on our side). */
function countsAgainstToken(status: number, gone: boolean): boolean {
  return gone || (status >= 400 && status !== 401 && status !== 403);
}

export interface DevicePushSummary {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Send one data message to every native device of these users. Dead tokens are
 * deleted at once; other failures count up and the token is dropped after
 * MAX_DEVICE_FAILURES in a row. A no-op without FCM credentials.
 */
export async function pushToDevices(
  env: DeviceEnv,
  userIds: string[],
  data: Record<string, unknown>,
  opts: FcmSendOptions = {},
  fetcher?: typeof fetch,
): Promise<DevicePushSummary> {
  const summary: DevicePushSummary = { sent: 0, failed: 0, removed: 0 };
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0 || !fcmConfigured(env)) return summary;
  const rows = await env.DB
    .prepare(`SELECT id, token, failure_count FROM device_push_tokens WHERE user_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; token: string; failure_count: number }>();
  const devices = rows.results ?? [];
  await Promise.all(
    devices.map(async (d) => {
      const r = await sendFcm(env, d.token, data, opts, fetcher);
      if (r.ok) {
        summary.sent++;
        await env.DB.prepare("UPDATE device_push_tokens SET last_success_at = datetime('now'), failure_count = 0 WHERE id = ?").bind(d.id).run();
      } else if (!countsAgainstToken(r.status, r.gone)) {
        // Our side (no network, bad / rejected credentials): not the device's fault.
        summary.failed++;
        console.warn('[fcm] send failed (not counted against the token)', r.status, r.error);
      } else if (r.gone || d.failure_count + 1 >= MAX_DEVICE_FAILURES) {
        summary.removed++;
        await env.DB.prepare('DELETE FROM device_push_tokens WHERE id = ?').bind(d.id).run();
      } else {
        summary.failed++;
        console.warn('[fcm] send failed', r.status, r.error);
        await env.DB.prepare('UPDATE device_push_tokens SET failure_count = failure_count + 1 WHERE id = ?').bind(d.id).run();
      }
    }),
  );
  return summary;
}
