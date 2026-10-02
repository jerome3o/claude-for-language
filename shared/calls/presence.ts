/**
 * Who is really in a call right now, and when an abandoned call ends by itself.
 * Pure, so the CallRoom Durable Object (worker/src/durable/call-room.ts) and
 * its tests share one state machine.
 *
 * A socket counts as present while it is open, has not said "leave" and was
 * heard from in the last PRESENCE_TIMEOUT_MS (every client pings every
 * ROOM_PING_MS = 10 s, so a phone that went to sleep, lost its network or was
 * killed without closing its socket drops out within ~45 s). A room nobody is
 * present in ends the call EMPTY_CALL_END_MS after the last person went (time
 * for a reload or a flaky network to come back); a call nobody ever entered
 * ends UNJOINED_CALL_END_MS after it was created (the caller may still be on
 * the pre-join screen sorting out camera permissions).
 */

/** A socket unheard from for this long counts as gone. */
export const PRESENCE_TIMEOUT_MS = 45_000;
/** The call ends this long after the last person left — 10 min (round 4; was 3): leaving to switch device, or a long network drop, never ends the lesson. */
export const EMPTY_CALL_END_MS = 10 * 60_000;
/** A call nobody ever entered ends this long after it was created. */
export const UNJOINED_CALL_END_MS = 10 * 60_000;
/** The room writes a socket's "last heard" time at most this often (a storage write per ping is wasteful). */
export const PRESENCE_SEEN_WRITE_MS = 5_000;
/** A call ended later than this after it was created (a stuck room swept up hours later) sends no "missed call". */
export const MISSED_ALERT_MAX_AGE_MS = 30 * 60_000;

export interface RoomSocketLike {
  userId: string;
  /** Epoch ms the room last heard from this socket (any message). */
  seen: number;
  /** The WebSocket is open (readyState OPEN). */
  open: boolean;
  /** The client said "leave" or the room timed it out. */
  left?: boolean;
}

export function isSocketPresent(s: RoomSocketLike, now: number): boolean {
  return s.open && !s.left && now - s.seen <= PRESENCE_TIMEOUT_MS;
}

/** The user ids with at least one present socket, sorted. */
export function presentUserIds(sockets: readonly RoomSocketLike[], now: number): string[] {
  return [...new Set(sockets.filter((s) => isSocketPresent(s, now)).map((s) => s.userId))].sort();
}

export interface RoomTimeline {
  now: number;
  /** When the call row was created (epoch ms), when known. */
  createdAt: number | null;
  /** When the room first heard of the call — the fallback for createdAt. */
  firstKnownAt: number;
  /** Someone has been in the room at some point. */
  everJoined: boolean;
  /** When the room last became empty (null while someone is in it). */
  emptySince: number | null;
  ended: boolean;
  sockets: readonly RoomSocketLike[];
}

export interface RoomPlan {
  /** Indices of sockets that are open but silent past the timeout: close them. */
  stale: number[];
  /** User ids present now. */
  present: string[];
  /** The new emptySince to keep. */
  emptySince: number | null;
  /** End the call now. */
  end: boolean;
  /** When to look again (the DO alarm), or null for never. */
  wakeAt: number | null;
}

/**
 * What the room should do now: which sockets have timed out, who is present,
 * whether to end the call, and when to check again. While someone is present
 * the room wakes just after the oldest present socket would time out (so a
 * silent disconnect is noticed); once empty it wakes at the end deadline.
 */
export function planRoom(t: RoomTimeline): RoomPlan {
  const stale: number[] = [];
  t.sockets.forEach((s, i) => {
    if (s.open && !s.left && t.now - s.seen > PRESENCE_TIMEOUT_MS) stale.push(i);
  });
  const present = presentUserIds(t.sockets, t.now);
  if (t.ended) return { stale, present: [], emptySince: t.emptySince, end: false, wakeAt: null };
  if (present.length > 0) {
    let oldest = Infinity;
    for (const s of t.sockets) if (isSocketPresent(s, t.now)) oldest = Math.min(oldest, s.seen);
    return { stale, present, emptySince: null, end: false, wakeAt: Math.max(t.now + 1_000, oldest + PRESENCE_TIMEOUT_MS + 1_000) };
  }
  const everJoined = t.everJoined || t.sockets.length > 0;
  const emptySince = everJoined ? t.emptySince ?? t.now : null;
  const deadline = everJoined ? emptySince! + EMPTY_CALL_END_MS : (t.createdAt ?? t.firstKnownAt) + UNJOINED_CALL_END_MS;
  const end = t.now >= deadline;
  return { stale, present, emptySince, end, wakeAt: end ? null : deadline };
}

/** Send "missed video call" only for a call that ended soon after it started ringing, not one swept up hours later. */
export function shouldAlertMissed(createdAt: number | null, endedAt: number): boolean {
  return createdAt !== null && Number.isFinite(createdAt) && endedAt - createdAt <= MISSED_ALERT_MAX_AGE_MS;
}
