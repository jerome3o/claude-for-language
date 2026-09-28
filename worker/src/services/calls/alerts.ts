/**
 * Call alerts over Web Push: when a call starts in a relationship, the other
 * person's browsers / installed PWA get "📹 <name> is calling" (tap → the call);
 * when it ends without them ever joining, that notification is replaced by
 * "Missed video call from <name>". An account set to 'silent' gets neither
 * (the in-app banner still shows). Failures never affect the call.
 */

import type { Env } from '../../types';
import { callMissedPush, callStartedPush } from '@shared/calls';
import { pushToUsers, normalizeCallAlerts } from '../push';
import { callMemberIds, getCall, type CallRow } from './store';

async function namesAndModes(db: D1Database, ids: string[]): Promise<Map<string, { name: string; mode: 'ring' | 'silent' }>> {
  const out = new Map<string, { name: string; mode: 'ring' | 'silent' }>();
  if (ids.length === 0) return out;
  const rows = await db
    .prepare(`SELECT id, name, email, call_alerts FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; name: string | null; email: string; call_alerts: string | null }>();
  for (const r of rows.results ?? []) out.set(r.id, { name: r.name || r.email.split('@')[0], mode: normalizeCallAlerts(r.call_alerts) });
  return out;
}

/** Who to ring for a call: the members other than the caller whose alerts are on. */
export async function callAlertRecipients(db: D1Database, call: CallRow, callerId: string): Promise<{ recipients: string[]; callerName: string }> {
  if (!call.relationship_id) return { recipients: [], callerName: '' };
  const members = await callMemberIds(db, call);
  const info = await namesAndModes(db, [...new Set([...members, callerId])]);
  const recipients = members.filter((id) => id !== callerId && info.get(id)?.mode !== 'silent');
  return { recipients, callerName: info.get(callerId)?.name ?? 'Your partner' };
}

export async function alertCallStarted(env: Env, call: CallRow, callerId: string): Promise<void> {
  try {
    const { recipients, callerName } = await callAlertRecipients(env.DB, call, callerId);
    if (recipients.length === 0) return;
    await pushToUsers(env, recipients, callStartedPush(call.id, callerName), { ttl: 120, urgency: 'high', topic: `call${call.id.replace(/-/g, '').slice(0, 24)}` });
  } catch (err) {
    console.error('[calls] start alert failed:', err);
  }
}

/** After the call ends: members who never joined get the missed-call notice (it replaces the ring). */
export async function alertCallMissed(env: Env, callId: string, joinedUserIds: readonly string[]): Promise<void> {
  try {
    const call = await getCall(env.DB, callId);
    if (!call || !call.relationship_id) return;
    const { recipients, callerName } = await callAlertRecipients(env.DB, call, call.created_by);
    const missed = recipients.filter((id) => !joinedUserIds.includes(id));
    if (missed.length === 0) return;
    await pushToUsers(env, missed, callMissedPush(call.id, callerName, call.relationship_id), {
      ttl: 6 * 3600,
      urgency: 'normal',
      topic: `call${call.id.replace(/-/g, '').slice(0, 24)}`,
    });
  } catch (err) {
    console.error('[calls] missed alert failed:', err);
  }
}
