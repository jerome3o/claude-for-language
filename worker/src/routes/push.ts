/**
 * Push notifications (call alerts). Mounted under /api after the auth middleware.
 *
 *   GET    /push/config          { public_key, call_alerts, subscriptions, fcm } — the VAPID key to subscribe with; fcm = native push configured
 *   POST   /push/subscriptions   { endpoint, keys: { p256dh, auth } } → 201 (idempotent by endpoint)
 *   DELETE /push/subscriptions   { endpoint }
 *   POST   /push/test            a test notification to my own devices → { sent, failed, removed }
 *   PUT    /profile/call-alerts  { call_alerts: 'ring' | 'silent' }
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { countSubscriptions, deleteSubscription, getVapidKeys, normalizeCallAlerts, PushError, pushToUsers, saveSubscription } from '../services/push';
import type { CallPushPayload } from '@shared/calls';
import { fcmConfigured } from '../services/push/fcm';

const push = new Hono<{ Bindings: Env }>();

push.get('/push/config', async (c) => {
  const user = c.get('user');
  const [keys, row, subscriptions] = await Promise.all([
    getVapidKeys(c.env),
    c.env.DB.prepare('SELECT call_alerts FROM users WHERE id = ?').bind(user.id).first<{ call_alerts: string | null }>(),
    countSubscriptions(c.env, user.id),
  ]);
  return c.json({ public_key: keys.publicKey, call_alerts: normalizeCallAlerts(row?.call_alerts), subscriptions, fcm: fcmConfigured(c.env) });
});

push.post('/push/subscriptions', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const saved = await saveSubscription(c.env, c.get('user').id, body, c.req.header('User-Agent') ?? null);
    return c.json({ ok: true, id: saved.id }, 201);
  } catch (error) {
    if (error instanceof PushError) return c.json({ error: error.message }, error.status);
    console.error('[push] subscribe failed:', error);
    return c.json({ error: 'Failed to save the subscription' }, 500);
  }
});

push.delete('/push/subscriptions', async (c) => {
  const body = await c.req.json<{ endpoint?: string }>().catch(() => ({} as { endpoint?: string }));
  if (typeof body.endpoint !== 'string' || !body.endpoint) return c.json({ error: 'endpoint is required' }, 400);
  return c.json({ ok: true, removed: await deleteSubscription(c.env, c.get('user').id, body.endpoint) });
});

push.post('/push/test', async (c) => {
  const payload: CallPushPayload = {
    type: 'test',
    call_id: null,
    title: '📹 Call alerts are on',
    body: 'This is how a call from your tutor or student will look.',
    url: '/settings',
    tag: 'call-alerts-test',
  };
  const result = await pushToUsers(c.env, [c.get('user').id], payload, { ttl: 60, urgency: 'high' });
  return c.json(result);
});

push.put('/profile/call-alerts', async (c) => {
  const body = await c.req.json<{ call_alerts?: string }>().catch(() => ({} as { call_alerts?: string }));
  if (body.call_alerts !== 'ring' && body.call_alerts !== 'silent') return c.json({ error: "call_alerts must be 'ring' or 'silent'" }, 400);
  await c.env.DB.prepare('UPDATE users SET call_alerts = ? WHERE id = ?').bind(body.call_alerts === 'ring' ? null : 'silent', c.get('user').id).run();
  return c.json({ call_alerts: body.call_alerts });
});

export default push;
