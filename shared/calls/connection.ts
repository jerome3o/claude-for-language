/**
 * Keeping a call alive through a bad connection — the pure rules both apps
 * follow (the Lab app's CallConnection.kt is parity-tested against these).
 *
 * - The signalling socket and the media connection are independent: a socket
 *   that drops and comes back from the SAME page load / app session
 *   (`instance`) keeps the RTCPeerConnection, so the picture never goes away
 *   for a signalling blip (`shouldAdoptPeer`). A peer whose socket is gone is
 *   kept, frozen, for `PEER_AWAY_GRACE_MS` before the link is torn down.
 * - A media connection that goes `disconnected` gets `DISCONNECT_GRACE_MS` to
 *   heal on its own, then an ICE restart; `failed` restarts at once; further
 *   restarts back off 2 s, 4 s, 8 s … 30 s (`nextIceRestartAt`). Nothing is
 *   restarted while the signalling socket is down (the offer couldn't reach the
 *   other side) — it happens as soon as the socket is back.
 * - Video encodings (`videoEncodingFor`): the camera keeps its frame rate and
 *   drops resolution under congestion (a talking face stays fluid); a shared
 *   screen keeps its resolution and drops frames (text stays sharp).
 * - Connection events go to the call's diagnostics log (`CallDiagEvent`).
 */

import type { CallPeer } from './protocol';

/** How long a `disconnected` media connection may heal by itself before an ICE restart. */
export const DISCONNECT_GRACE_MS = 2500;
/** How long a peer whose socket dropped is kept (the last frame frozen) before we give up on them. */
export const PEER_AWAY_GRACE_MS = 30_000;
/** Longest wait between two ICE restarts. */
export const MAX_RESTART_BACKOFF_MS = 30_000;
/** Ping cadence on the room socket, and how long a pong may take before the socket is treated as dead. */
export const ROOM_PING_MS = 10_000;
export const ROOM_PONG_TIMEOUT_MS = 8_000;

export type PcState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface LinkHealth {
  pc: PcState;
  /** When `pc` last changed (ms). */
  changedAt: number;
  /** ICE restarts since the connection was last `connected`. */
  restarts: number;
  lastRestartAt: number | null;
  /** Has this link ever been connected (a later drop is a *re*connect). */
  everConnected: boolean;
}

export function initialLinkHealth(now: number): LinkHealth {
  return { pc: 'new', changedAt: now, restarts: 0, lastRestartAt: null, everConnected: false };
}

export type LinkEvent = { type: 'pc'; state: PcState; at: number } | { type: 'restarted'; at: number };

export function linkHealthOn(h: LinkHealth, e: LinkEvent): LinkHealth {
  if (e.type === 'restarted') return { ...h, restarts: h.restarts + 1, lastRestartAt: e.at };
  if (e.state === h.pc) return h;
  if (e.state === 'connected') return { pc: 'connected', changedAt: e.at, restarts: 0, lastRestartAt: null, everConnected: true };
  return { ...h, pc: e.state, changedAt: e.at };
}

/** Wait before restart number `n` (1 = the first after the initial one): 2 s, 4 s, 8 s … 30 s. */
export function restartBackoffMs(n: number): number {
  return Math.min(MAX_RESTART_BACKOFF_MS, 2000 * 2 ** Math.max(0, n - 1));
}

/**
 * When to restart ICE next (ms since epoch; may be in the past = now), or null
 * when nothing needs doing (connected / still connecting / signalling down).
 */
export function nextIceRestartAt(h: LinkHealth, signallingOpen: boolean): number | null {
  if (!signallingOpen) return null;
  if (h.pc !== 'disconnected' && h.pc !== 'failed') {
    // A restart that never got back to `connected` (stuck `connecting`) is retried on the backoff.
    if (h.pc === 'connecting' && h.lastRestartAt !== null) return h.lastRestartAt + restartBackoffMs(h.restarts) + DISCONNECT_GRACE_MS;
    return null;
  }
  if (h.restarts === 0) return h.pc === 'failed' ? h.changedAt : h.changedAt + DISCONNECT_GRACE_MS;
  return (h.lastRestartAt ?? h.changedAt) + restartBackoffMs(h.restarts);
}

/** The small badge in the other person's tile. */
export type TileStatus = 'live' | 'connecting' | 'reconnecting';

export function tileStatus(h: Pick<LinkHealth, 'pc' | 'everConnected'>, peerAway: boolean): TileStatus {
  if (h.pc === 'connected') return 'live';
  return h.everConnected || peerAway ? 'reconnecting' : 'connecting';
}

/**
 * A (re)announced peer is the same connection as the one we have when it is
 * the same person from the same page load / app session.
 */
export function shouldAdoptPeer(current: { user_id: string; instance?: string } | null | undefined, incoming: Pick<CallPeer, 'user_id' | 'instance'>): boolean {
  return !!current && !!incoming.instance && current.instance === incoming.instance && current.user_id === incoming.user_id;
}

/** A random instance id for this page load / app session. */
export function newInstanceId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function sanitizeInstance(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^[a-z0-9]{4,32}$/i.test(raw) ? raw : undefined;
}

// ------------------------------------------------------------------ encodings

export type VideoSource = 'camera' | 'screen';

export interface VideoEncoding {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  degradationPreference: 'maintain-framerate' | 'maintain-resolution';
}

export const CAMERA_MAX_BITRATE = 900_000;
export const SCREEN_MAX_BITRATE = 1_500_000;
/** Below these outgoing estimates the camera halves / quarters its resolution (with 1.5× hysteresis to come back). */
export const CAMERA_HALF_BELOW_BPS = 350_000;
export const CAMERA_QUARTER_BELOW_BPS = 180_000;

/**
 * The sender's encoding for a video source given the connection's estimated
 * outgoing bitrate (`availableOutgoingBitrate`, bits/s; null = unknown) and the
 * scale in use now (so it doesn't flap).
 */
export function videoEncodingFor(source: VideoSource, availableBps: number | null, currentScale = 1): VideoEncoding {
  if (source === 'screen') {
    return { maxBitrate: SCREEN_MAX_BITRATE, maxFramerate: 15, scaleResolutionDownBy: 1, degradationPreference: 'maintain-resolution' };
  }
  let scale = 1;
  if (availableBps !== null) {
    const quarter = currentScale >= 4 ? CAMERA_QUARTER_BELOW_BPS * 1.5 : CAMERA_QUARTER_BELOW_BPS;
    const half = currentScale >= 2 ? CAMERA_HALF_BELOW_BPS * 1.5 : CAMERA_HALF_BELOW_BPS;
    if (availableBps < quarter) scale = 4;
    else if (availableBps < half) scale = 2;
  } else scale = currentScale;
  return { maxBitrate: CAMERA_MAX_BITRATE, maxFramerate: 24, scaleResolutionDownBy: scale, degradationPreference: 'maintain-framerate' };
}

// ------------------------------------------------------------------ diagnostics

export type CallDiagKind = 'pc' | 'ice' | 'room' | 'restart' | 'route' | 'media' | 'join' | 'peer';

export interface CallDiagEvent {
  /** ms since epoch (client clock). */
  t: number;
  kind: CallDiagKind;
  detail: string;
}

/** A stored event with who reported it. */
export interface CallDiagEntry extends CallDiagEvent {
  user_id: string;
  name: string;
}

const DIAG_KINDS: CallDiagKind[] = ['pc', 'ice', 'room', 'restart', 'route', 'media', 'join', 'peer'];
export const MAX_DIAG_EVENTS_PER_MESSAGE = 50;
export const MAX_DIAG_EVENTS = 600;

export function sanitizeDiagEvents(raw: unknown): CallDiagEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CallDiagEvent[] = [];
  for (const e of raw.slice(0, MAX_DIAG_EVENTS_PER_MESSAGE)) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const t = Number(r.t);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (!DIAG_KINDS.includes(r.kind as CallDiagKind)) continue;
    const detail = typeof r.detail === 'string' ? r.detail.replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
    out.push({ t: Math.round(t), kind: r.kind as CallDiagKind, detail });
  }
  return out;
}

/** Keep the newest `MAX_DIAG_EVENTS`, in time order. */
export function appendDiag(log: CallDiagEntry[], add: CallDiagEntry[]): CallDiagEntry[] {
  const all = [...log, ...add].sort((a, b) => a.t - b.t);
  return all.length > MAX_DIAG_EVENTS ? all.slice(all.length - MAX_DIAG_EVENTS) : all;
}

/** The IME composition preview next to someone's caret: one line, ≤ 40 characters. */
export const MAX_COMPOSE_CHARS = 40;

export function sanitizeCompose(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const one = raw.replace(/[\r\n\t]+/g, ' ');
  if (!one.trim()) return null;
  return Array.from(one).slice(0, MAX_COMPOSE_CHARS).join('');
}
