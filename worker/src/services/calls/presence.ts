/**
 * Who is in each live call right now, from the call's room (the CallRoom
 * Durable Object keeps the heartbeat, see shared/calls/presence.ts).
 *
 * `GET /api/calls` asks the room of every live call it lists, so a banner only
 * announces a call someone is actually connected to. Asking is also how rooms
 * that should have ended get swept up: the room ends a call past its deadline
 * the moment it's asked, through the same path as its alarm and the End button
 * (ended_at, "missed call" push when recent, post-call processing).
 */

import type { Env } from '../../types';
import { parseCallTime } from '@shared/calls';
import { advanceCallProcessing } from './processing';
import { markCallEnded } from './store';

/** How long one room may take to answer before the list goes out without its presence. */
const PRESENCE_TIMEOUT_MS = 2_500;
/** At most this many rooms are asked per list (live calls are rare; the rest keep the old rule). */
const MAX_ROOMS_ASKED = 10;

export interface RoomPresenceResult {
  present: string[];
  ended: boolean;
}

interface LiveRowLike {
  id: string;
  status: string;
  created_at: string;
  ended_at?: number | null;
  present_user_ids?: string[];
}

/** Ask one call's room who is there (and let it end itself if its time is up). Null when it can't say. */
export async function roomPresence(env: Env, callId: string, createdAt: string | null): Promise<RoomPresenceResult | null> {
  if (!env.CALL_ROOM) return null;
  const created = parseCallTime(createdAt);
  try {
    const stub = env.CALL_ROOM.get(env.CALL_ROOM.idFromName(callId));
    const ask = stub.presence(callId, Number.isFinite(created) ? created : null) as Promise<RoomPresenceResult>;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PRESENCE_TIMEOUT_MS));
    return await Promise.race([ask, timeout]);
  } catch (err) {
    console.error('[calls] presence failed:', err);
    return null;
  }
}

/**
 * Fill `present_user_ids` on the live rows (in place) and mark rows whose room
 * has ended as ended. A room that doesn't answer leaves its row without
 * presence — the clients then fall back to the call's age.
 */
export async function withPresence<T extends LiveRowLike>(env: Env, rows: T[], bg?: { waitUntil(p: Promise<unknown>): void }): Promise<T[]> {
  const live = rows.filter((r) => r.status === 'live').slice(0, MAX_ROOMS_ASKED);
  await Promise.all(
    live.map(async (row) => {
      const res = await roomPresence(env, row.id, row.created_at);
      if (!res) return;
      if (res.ended) {
        row.status = 'ended';
        row.ended_at = row.ended_at ?? Date.now();
        // The room normally did this itself; make sure the row agrees (idempotent).
        const fix = markCallEnded(env.DB, row.id).then((changed) => (changed ? advanceCallProcessing(env, row.id) : undefined)).catch((err) => console.error('[calls] end fix-up failed:', err));
        if (bg) bg.waitUntil(fix);
        else await fix;
        return;
      }
      row.present_user_ids = res.present;
    }),
  );
  return rows;
}
