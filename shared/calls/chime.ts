/**
 * Call sounds (Minghui, Oct 2026): a soft chime and a short toast when the OTHER person enters
 * the call ("Minghui joined"), a softer, lower one when they leave ("Minghui left"), and a gentle
 * bell when the call timer reaches zero (./timer.ts).
 *
 * What counts comes from the room's presence events (`welcome.peers`, `peer_joined`,
 * `peer_left`; ./presence.ts decides who is present):
 * - my own join and my own reconnects never chime (a `welcome` only takes note of who is there);
 * - their socket reconnecting (a network blip, the same page — the room sends `peer_left` then
 *   `peer_joined`) never chimes: a leave is announced only when they have stayed away for
 *   PEER_LEAVE_GRACE_MS, and coming back inside it is silent;
 * - after an announced leave, their return is announced again ("Minghui joined").
 * The sounds can be switched off in the call's ⋯ menu, remembered per device ([CALL_SOUNDS_KEY]).
 *
 * Pure rules for the web call page and the Lab app (`core/…/calls/CallChime.kt`,
 * parity-tested by parity/fixtures/calls-chime.ts). The tones themselves: [CHIME_TONES].
 */

/** How long someone must stay away before "… left" (a reconnect takes a few seconds). */
export const PEER_LEAVE_GRACE_MS = 8_000;

export type ChimeKind = 'join' | 'leave' | 'timer';

export interface ChimePeer {
  client_id: string;
  name: string;
  /** Here now (false = left, maybe not announced yet). */
  here: boolean;
  /** When they left (room events, device time); null while here. */
  left_at: number | null;
  /** "… left" was shown: their return will be announced. */
  announced_left: boolean;
}

/** Everyone this device has seen in the call, by user id. */
export interface ChimeState {
  peers: Record<string, ChimePeer>;
}

export const EMPTY_CHIME_STATE: ChimeState = { peers: {} };

export interface ChimeAlert {
  kind: 'join' | 'leave';
  user_id: string;
  name: string;
  text: string;
}

export type ChimeEvent =
  /** I (re)joined: these are here. Never announced. */
  | { type: 'welcome'; peers: Array<{ client_id: string; user_id: string; name: string }> }
  | { type: 'joined'; peer: { client_id: string; user_id: string; name: string } }
  | { type: 'left'; client_id: string }
  /** Time passes (a timer tick): leaves past the grace are announced. */
  | { type: 'tick' };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'They';

export function joinedText(name: string): string {
  return `${firstName(name)} joined`;
}

export function leftText(name: string): string {
  return `${firstName(name)} left`;
}

/** The next state and the alerts (toast + chime) to show, for one presence event at `now`. */
export function chimeStep(state: ChimeState, event: ChimeEvent, myUserId: string, now: number): { state: ChimeState; alerts: ChimeAlert[] } {
  const peers = { ...state.peers };
  const alerts: ChimeAlert[] = [];
  switch (event.type) {
    case 'welcome': {
      // Someone I counted as here who isn't any more (they left while my connection was down).
      for (const [userId, p] of Object.entries(peers)) {
        if (p.here && !event.peers.some((q) => q.user_id === userId)) peers[userId] = { ...p, here: false, left_at: now };
      }
      for (const p of event.peers) {
        if (p.user_id === myUserId) continue;
        peers[p.user_id] = { client_id: p.client_id, name: p.name, here: true, left_at: null, announced_left: false };
      }
      break;
    }
    case 'joined': {
      const p = event.peer;
      if (p.user_id === myUserId) break;
      const prev = peers[p.user_id];
      // New to me, or back after "… left" was shown: announce. Back inside the grace (a reconnect)
      // or replacing a socket that is still here: silent.
      if (!prev || (!prev.here && prev.announced_left)) alerts.push({ kind: 'join', user_id: p.user_id, name: p.name, text: joinedText(p.name) });
      peers[p.user_id] = { client_id: p.client_id, name: p.name, here: true, left_at: null, announced_left: false };
      break;
    }
    case 'left': {
      const entry = Object.entries(peers).find(([, p]) => p.client_id === event.client_id && p.here);
      if (entry) peers[entry[0]] = { ...entry[1], here: false, left_at: now };
      break;
    }
    case 'tick':
      break;
  }
  // Leaves past the grace are announced (on any event, so a `tick` every second is enough).
  for (const [userId, p] of Object.entries(peers)) {
    if (!p.here && !p.announced_left && p.left_at !== null && now - p.left_at >= PEER_LEAVE_GRACE_MS) {
      peers[userId] = { ...p, announced_left: true };
      alerts.push({ kind: 'leave', user_id: userId, name: p.name, text: leftText(p.name) });
    }
  }
  return { state: { peers }, alerts };
}

/** Somebody left and isn't announced yet: the device needs a tick (until then nothing changes). */
export function chimeNeedsTick(state: ChimeState): boolean {
  return Object.values(state.peers).some((p) => !p.here && !p.announced_left && p.left_at !== null);
}

// ------------------------------------------------------------------ the sounds

/** One note of a chime: a sine with a soft attack and a long decay. */
export interface ChimeTone {
  /** Hz. */
  freq: number;
  /** Start, ms after the chime starts. */
  at: number;
  /** Length, ms. */
  ms: number;
  /** Peak gain, 0–1 (kept low: it plays under people talking). */
  gain: number;
}

/**
 * The three chimes, made on the device (WebAudio on the web, PCM on Android — nothing to license):
 * join = a rising major third (E5 → G♯5), leave = a falling one, lower and quieter (C5 → A4),
 * timer = three bell notes (A5 · E5 · A5).
 */
export const CHIME_TONES: Record<ChimeKind, ChimeTone[]> = {
  join: [
    { freq: 659.25, at: 0, ms: 380, gain: 0.16 },
    { freq: 830.61, at: 140, ms: 520, gain: 0.16 },
  ],
  leave: [
    { freq: 523.25, at: 0, ms: 380, gain: 0.1 },
    { freq: 440.0, at: 160, ms: 520, gain: 0.1 },
  ],
  timer: [
    { freq: 880.0, at: 0, ms: 700, gain: 0.2 },
    { freq: 659.25, at: 260, ms: 700, gain: 0.2 },
    { freq: 880.0, at: 520, ms: 1100, gain: 0.2 },
  ],
};

/** The attack of every tone, ms. */
export const CHIME_ATTACK_MS = 12;

/**
 * One sample of a chime at `tMs` (−1…1 before the gain stage): every tone's sine, a linear attack
 * and an exponential decay to silence over its length. Used by the Lab app to fill a PCM buffer;
 * the web builds the same envelopes with WebAudio gain ramps.
 */
export function chimeSample(kind: ChimeKind, tMs: number): number {
  let v = 0;
  for (const tone of CHIME_TONES[kind]) {
    const t = tMs - tone.at;
    if (t < 0 || t >= tone.ms) continue;
    const env = t < CHIME_ATTACK_MS ? t / CHIME_ATTACK_MS : Math.exp((-5 * (t - CHIME_ATTACK_MS)) / tone.ms);
    v += tone.gain * env * Math.sin((2 * Math.PI * tone.freq * t) / 1000);
  }
  return v;
}

/** How long a chime lasts, ms. */
export function chimeLengthMs(kind: ChimeKind): number {
  return Math.max(...CHIME_TONES[kind].map((t) => t.at + t.ms));
}

/** Per device: are call sounds on (absent = on). */
export const CALL_SOUNDS_KEY = 'call-sounds-v1';

export function callSoundsOn(stored: string | null): boolean {
  return stored !== 'off';
}

export const CALL_SOUNDS_ON_LABEL = '🔔 Call sounds: on';
export const CALL_SOUNDS_OFF_LABEL = '🔕 Call sounds: off';

export function callSoundsLabel(on: boolean): string {
  return on ? CALL_SOUNDS_ON_LABEL : CALL_SOUNDS_OFF_LABEL;
}
