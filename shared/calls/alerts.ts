/**
 * "Someone is calling" — which live call to announce, and when to ring. Pure,
 * so the web app (components/calls/CallAlerts.tsx) and the Lab app
 * (core/…/calls/CallAlerts.kt, parity-tested) make the same decisions from the
 * same `GET /api/calls?live=1` list.
 */

/** The fields of a `GET /api/calls` row the alerts use. */
export interface LiveCallLike {
  id: string;
  relationship_id: string | null;
  created_by: string;
  status: string;
  /** SQLite `datetime('now')` ("2026-09-28 10:00:00", UTC) or ISO. */
  created_at: string;
  other_user_name: string | null;
  /**
   * Who is connected to the call's room right now (the room's heartbeat, see
   * shared/calls/presence.ts). Absent from an older server: then the call's
   * age decides, as before.
   */
  present_user_ids?: readonly string[] | null;
}

export type CallBannerKind = 'incoming' | 'rejoin' | 'test';

export interface CallBanner {
  call_id: string;
  relationship_id: string | null;
  kind: CallBannerKind;
  /** "王老师 is calling" / "Your call with 王老师 is still on" / "Your test call is still open". */
  title: string;
  /** The button: "Join" / "Rejoin" / "Open". */
  action: string;
  url: string;
  /** The other person's name, when there is one. */
  name: string | null;
}

/** Without presence (an older server), a live call older than this is not announced. */
export const CALL_BANNER_MAX_AGE_MS = 4 * 60 * 60_000;
/** Ring only for a call that started this recently (polling may see it up to ~20 s late). */
export const CALL_RING_WINDOW_MS = 2 * 60_000;
/** How long the in-app ring goes on before it stops by itself. */
export const CALL_RING_DURATION_MS = 30_000;
/** Poll period for the live list while the app is open and visible. */
export const LIVE_CALL_POLL_MS = 20_000;

/** Parse a SQLite datetime (UTC, no zone) or an ISO string to epoch ms; NaN when unreadable. */
export function parseCallTime(value: string | null | undefined): number {
  if (!value) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return Date.parse(iso);
}

/** The path of a live call page (`/calls/<id>`, not its review). */
export function callIdFromPath(path: string): string | null {
  const m = /^\/calls\/([^/?#]+)\/?$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Is there anyone to join? Someone OTHER than me is connected to the room right
 * now and I am not (on any device). A call whose caller left, or that nobody
 * ever entered, is not "calling" however long its row says live. Null when the
 * server didn't say (older server): the caller falls back to the call's age.
 */
export function someoneElseInCall(call: LiveCallLike, myUserId: string): boolean | null {
  if (!Array.isArray(call.present_user_ids)) return null;
  const present = call.present_user_ids;
  return !present.includes(myUserId) && present.some((id) => id !== myUserId);
}

function bannerFor(call: LiveCallLike, myUserId: string): CallBanner {
  const name = call.other_user_name?.trim() || null;
  const who = name ?? 'Your partner';
  const url = `/calls/${call.id}`;
  if (!call.relationship_id) {
    return { call_id: call.id, relationship_id: null, kind: 'test', title: 'Your test call is still open', action: 'Open', url, name: null };
  }
  if (call.created_by !== myUserId) {
    return { call_id: call.id, relationship_id: call.relationship_id, kind: 'incoming', title: `${who} is calling`, action: 'Join', url, name };
  }
  return {
    call_id: call.id,
    relationship_id: call.relationship_id,
    kind: 'rejoin',
    title: name ? `Your call with ${name} is still on` : 'Your call is still on',
    action: 'Rejoin',
    url,
    name,
  };
}

export interface BannerContext {
  myUserId: string;
  /** Current pathname: no banner for the call whose page is open. */
  path: string;
  now: number;
  /** Call ids the user closed the banner for. */
  dismissed?: readonly string[];
  /** Only this relationship's calls (the student / tutor page, the chat). */
  relationshipId?: string | null;
  /** Leave out solo test calls (they're only announced on the calls page). */
  includeTest?: boolean;
}

/**
 * The one call to announce, or null. Incoming calls (someone else started
 * them) come first, newest first; then my own call to rejoin; test calls only
 * when asked. Only a call someone else is in right now and I'm not
 * (`someoneElseInCall`; without presence data: not older than
 * CALL_BANNER_MAX_AGE_MS); ended ones, dismissed ones and the call already on
 * screen are left out.
 */
export function pickCallBanner(calls: readonly LiveCallLike[], ctx: BannerContext): CallBanner | null {
  const onPage = callIdFromPath(ctx.path);
  const dismissed = new Set(ctx.dismissed ?? []);
  const candidates = calls.filter((c) => {
    if (c.status !== 'live' || c.id === onPage || dismissed.has(c.id)) return false;
    if (ctx.relationshipId !== undefined && ctx.relationshipId !== null && c.relationship_id !== ctx.relationshipId) return false;
    if (!c.relationship_id && !ctx.includeTest) return false;
    const t = parseCallTime(c.created_at);
    if (!Number.isFinite(t)) return false;
    const joinable = someoneElseInCall(c, ctx.myUserId);
    return joinable === null ? ctx.now - t <= CALL_BANNER_MAX_AGE_MS : joinable;
  });
  const rank = (c: LiveCallLike) => (!c.relationship_id ? 2 : c.created_by !== ctx.myUserId ? 0 : 1);
  candidates.sort((a, b) => rank(a) - rank(b) || parseCallTime(b.created_at) - parseCallTime(a.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates.length ? bannerFor(candidates[0], ctx.myUserId) : null;
}

export interface RingContext {
  myUserId: string;
  now: number;
  /** Calls this device already rang for (or saw before it could ring). */
  rung: readonly string[];
  /** The account's setting: 'silent' never rings. */
  mode: 'ring' | 'silent';
  /** The call's own page is open: no ring. */
  path: string;
}

/**
 * The call to ring for, or null: an incoming call (someone else started it, in
 * a relationship) that started within CALL_RING_WINDOW_MS, that someone else
 * is actually in right now (when the server reports presence), not rung
 * before on this device, not open on screen, and only when the account rings.
 */
export function callToRing(calls: readonly LiveCallLike[], ctx: RingContext): LiveCallLike | null {
  if (ctx.mode === 'silent') return null;
  const onPage = callIdFromPath(ctx.path);
  const rung = new Set(ctx.rung);
  let best: LiveCallLike | null = null;
  for (const c of calls) {
    if (c.status !== 'live' || !c.relationship_id || c.created_by === ctx.myUserId || rung.has(c.id) || c.id === onPage) continue;
    if (someoneElseInCall(c, ctx.myUserId) === false) continue;
    const t = parseCallTime(c.created_at);
    if (!Number.isFinite(t) || ctx.now - t > CALL_RING_WINDOW_MS || t - ctx.now > CALL_RING_WINDOW_MS) continue;
    if (!best || t > parseCallTime(best.created_at)) best = c;
  }
  return best;
}

/** What a call push carries (worker services/calls/alerts.ts → the service worker / the Lab app). */
export interface CallPushPayload {
  type: 'call' | 'call_missed' | 'test';
  call_id: string | null;
  title: string;
  body: string;
  /** Path to open on tap. */
  url: string;
  /** Notification tag: the missed-call notice replaces the ringing one. */
  tag: string;
}

export function callStartedPush(callId: string, callerName: string): CallPushPayload {
  return {
    type: 'call',
    call_id: callId,
    title: `📹 ${callerName} is calling`,
    body: 'Tap to join the video lesson',
    url: `/calls/${callId}`,
    tag: `call-${callId}`,
  };
}

export function callMissedPush(callId: string, callerName: string, relationshipId: string | null): CallPushPayload {
  return {
    type: 'call_missed',
    call_id: callId,
    title: `Missed video call from ${callerName}`,
    body: 'Tap to message them',
    url: relationshipId ? `/connections/${relationshipId}` : '/calls',
    tag: `call-${callId}`,
  };
}
