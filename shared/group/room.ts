/**
 * Group classes (EXPERIMENTAL web prototype, docs/GROUP_CLASSES.md): one tutor
 * and up to MAX_GROUP_STUDENTS of her students in one live room.
 *
 * This file is the room's pure state: who is muted by the tutor, who is in the
 * spotlight, whose hand is up — and who may change what. The GroupRoom Durable
 * Object (worker/src/durable/group-room.ts) applies every control through
 * `applyControl` and broadcasts the result; the clients render it.
 *
 * Muting is enforced twice: the muted student's own page turns its microphone
 * off (and keeps it off until the tutor lifts the mute), and every OTHER page
 * silences that student's audio while the mute stands — so a modified or slow
 * client can't talk over the class. Mutes are by user id and stick across a
 * reconnect.
 */

export const MIN_GROUP_STUDENTS = 2;
export const MAX_GROUP_STUDENTS = 6;
/** Tutor + students: the most people a group room takes. */
export const MAX_GROUP_PEOPLE = MAX_GROUP_STUDENTS + 1;
export const GROUP_NAME_MAX = 60;

export type GroupRole = 'tutor' | 'student';

export interface GroupPeerState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
}

export interface GroupPeer {
  client_id: string;
  user_id: string;
  name: string;
  picture_url: string | null;
  role: GroupRole;
  state: GroupPeerState;
  /** One per page load (a reconnect from the same page keeps its WebRTC links). */
  instance?: string;
}

export interface RaisedHand {
  user_id: string;
  at: number;
}

export interface GroupRoomState {
  /** Students the tutor muted (user ids, sorted). */
  muted: string[];
  /** The person everyone sees big, or null. */
  spotlight: string | null;
  /** Raised hands, oldest first. */
  hands: RaisedHand[];
}

export const EMPTY_ROOM_STATE: GroupRoomState = { muted: [], spotlight: null, hands: [] };

export type GroupControl =
  | { kind: 'mute'; user_id: string; muted: boolean }
  | { kind: 'mute_all' }
  | { kind: 'spotlight'; user_id: string | null }
  | { kind: 'hand'; up: boolean }
  | { kind: 'lower_hand'; user_id: string };

export interface ControlContext {
  /** Who is asking. */
  actor: string;
  tutorId: string;
  /** User ids present in the room now. */
  present: readonly string[];
  now: number;
}

const idOf = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);

/** Validate a control from a client (anything else → null). */
export function sanitizeControl(raw: unknown): GroupControl | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case 'mute': {
      const user = idOf(r.user_id);
      return user && typeof r.muted === 'boolean' ? { kind: 'mute', user_id: user, muted: r.muted } : null;
    }
    case 'mute_all':
      return { kind: 'mute_all' };
    case 'spotlight': {
      if (r.user_id === null) return { kind: 'spotlight', user_id: null };
      const user = idOf(r.user_id);
      return user ? { kind: 'spotlight', user_id: user } : null;
    }
    case 'hand':
      return typeof r.up === 'boolean' ? { kind: 'hand', up: r.up } : null;
    case 'lower_hand': {
      const user = idOf(r.user_id);
      return user ? { kind: 'lower_hand', user_id: user } : null;
    }
    default:
      return null;
  }
}

const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();

/**
 * The room after `control`, or null when the actor may not do it (or it
 * changes nothing). Tutor only: mute / unmute a student, mute everyone,
 * spotlight. Students: raise / lower their own hand. Lowering someone else's
 * hand: the tutor.
 */
export function applyControl(state: GroupRoomState, control: GroupControl, ctx: ControlContext): GroupRoomState | null {
  const isTutor = ctx.actor === ctx.tutorId;
  switch (control.kind) {
    case 'mute': {
      if (!isTutor || control.user_id === ctx.tutorId) return null;
      const has = state.muted.includes(control.user_id);
      if (has === control.muted) return null;
      const muted = control.muted ? sorted([...state.muted, control.user_id]) : state.muted.filter((u) => u !== control.user_id);
      return { ...state, muted };
    }
    case 'mute_all': {
      if (!isTutor) return null;
      const muted = sorted([...state.muted, ...ctx.present.filter((u) => u !== ctx.tutorId)]);
      if (muted.length === state.muted.length) return null;
      return { ...state, muted };
    }
    case 'spotlight': {
      if (!isTutor) return null;
      if (control.user_id !== null && !ctx.present.includes(control.user_id)) return null;
      if (state.spotlight === control.user_id) return null;
      return { ...state, spotlight: control.user_id };
    }
    case 'hand': {
      if (isTutor) return null;
      const up = state.hands.some((h) => h.user_id === ctx.actor);
      if (up === control.up) return null;
      const hands = control.up ? [...state.hands, { user_id: ctx.actor, at: ctx.now }] : state.hands.filter((h) => h.user_id !== ctx.actor);
      return { ...state, hands };
    }
    case 'lower_hand': {
      if (!isTutor && control.user_id !== ctx.actor) return null;
      if (!state.hands.some((h) => h.user_id === control.user_id)) return null;
      return { ...state, hands: state.hands.filter((h) => h.user_id !== control.user_id) };
    }
  }
}

/**
 * Someone left the room: their hand goes down and the spotlight on them ends.
 * A mute stays (only the tutor lifts it, so a rejoin can't dodge it).
 */
export function personLeft(state: GroupRoomState, userId: string): GroupRoomState {
  const hands = state.hands.filter((h) => h.user_id !== userId);
  const spotlight = state.spotlight === userId ? null : state.spotlight;
  if (hands.length === state.hands.length && spotlight === state.spotlight) return state;
  return { ...state, hands, spotlight };
}

/** Is this person audible to the class (mic on and not muted by the tutor)? */
export function isAudible(peer: Pick<GroupPeer, 'user_id' | 'state'>, room: GroupRoomState): boolean {
  return peer.state.mic && !room.muted.includes(peer.user_id);
}

/** A peer state from a client, clamped; a muted student's mic always reads off. */
export function sanitizePeerState(raw: unknown, mutedByTutor: boolean): GroupPeerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return { mic: r.mic === true && !mutedByTutor, cam: r.cam === true, screen: r.screen === true };
}

/** Group name rules: trimmed, 1–60 characters, one line. */
export function cleanGroupName(raw: unknown): { name: string } | { problem: string } {
  if (typeof raw !== 'string') return { problem: 'Give the group a name' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { problem: 'Give the group a name' };
  if (Array.from(name).length > GROUP_NAME_MAX) return { problem: `Keep the name under ${GROUP_NAME_MAX} characters` };
  return { name };
}

/** Member list rules: MIN..MAX distinct students. */
export function memberProblem(ids: readonly string[]): string | null {
  const n = new Set(ids).size;
  if (n < MIN_GROUP_STUDENTS) return `Pick at least ${MIN_GROUP_STUDENTS} students`;
  if (n > MAX_GROUP_STUDENTS) return `A group class takes at most ${MAX_GROUP_STUDENTS} students (every browser sends its video to every other one)`;
  return null;
}

/**
 * Who makes the WebRTC offer between two clients of the mesh: the lower client
 * id (impolite) offers; the other is polite (answers, and yields on a collision).
 */
export function isPolite(myClientId: string, theirClientId: string): boolean {
  return myClientId > theirClientId;
}
