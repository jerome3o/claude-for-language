/**
 * The group class's stage (EXPERIMENTAL): a gallery of everyone's camera, the
 * tutor's spotlight or a shared screen big on top, and the active speaker
 * highlighted. Pure helpers so the rules are unit-tested.
 */

import type { GroupPeer, GroupRoomState } from './room';

/** The grid that makes N 16:9 tiles as big as possible in a width × height box. */
export function galleryGrid(n: number, width: number, height: number, gap = 6): { cols: number; rows: number; tileW: number; tileH: number } {
  if (n <= 0 || width <= 0 || height <= 0) return { cols: 1, rows: 1, tileW: Math.max(0, width), tileH: Math.max(0, height) };
  let best = { cols: 1, rows: n, tileW: 0, tileH: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // Largest 16:9 rectangle inside the cell.
    const tileW = Math.min(cellW, (cellH * 16) / 9);
    const tileH = (tileW * 9) / 16;
    if (tileW > best.tileW + 0.5) best = { cols, rows, tileW, tileH };
  }
  return { cols: best.cols, rows: best.rows, tileW: Math.floor(best.tileW), tileH: Math.floor(best.tileH) };
}

/**
 * Gallery order: the tutor first, then students by name (stable while people
 * join and leave), me last among the students so my own face isn't the first
 * thing I see. The spotlighted person is taken out (they are on the stage).
 */
export function galleryOrder<T extends Pick<GroupPeer, 'user_id' | 'name' | 'role'>>(people: readonly T[], room: Pick<GroupRoomState, 'spotlight'>, myUserId: string): T[] {
  return people
    .filter((p) => p.user_id !== room.spotlight)
    .slice()
    .sort((a, b) => {
      const rank = (p: T) => (p.role === 'tutor' ? 0 : p.user_id === myUserId ? 2 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id);
    });
}

/** What goes big on top: a shared screen first, then the spotlight, else nothing (gallery only). */
export function stageOf(people: readonly Pick<GroupPeer, 'user_id' | 'state'>[], room: Pick<GroupRoomState, 'spotlight'>): { kind: 'screen' | 'spotlight'; user_id: string } | null {
  const sharer = people.find((p) => p.state.screen);
  if (sharer) return { kind: 'screen', user_id: sharer.user_id };
  if (room.spotlight && people.some((p) => p.user_id === room.spotlight)) return { kind: 'spotlight', user_id: room.spotlight };
  return null;
}

/** Audio level (0..1 RMS) above which someone counts as speaking. */
export const SPEAKING_LEVEL = 0.04;
/** A new speaker takes over only after the current one held it this long (no flicker). */
export const SPEAKER_HOLD_MS = 1200;
/** …and only when clearly louder than the current one. */
export const SPEAKER_MARGIN = 1.3;

export interface SpeakerState {
  id: string | null;
  since: number;
}

/**
 * The active speaker after one sample of everyone's level: the loudest person
 * above SPEAKING_LEVEL, with hysteresis — the current speaker keeps it while
 * still speaking, or until SPEAKER_HOLD_MS has passed and someone else is
 * clearly louder. Silence keeps the last speaker highlighted (as in most
 * meeting apps) until someone else speaks.
 */
export function nextSpeaker(levels: Readonly<Record<string, number>>, current: SpeakerState, now: number): SpeakerState {
  let loudest: string | null = null;
  let top = SPEAKING_LEVEL;
  for (const [id, level] of Object.entries(levels)) {
    if (level > top) {
      top = level;
      loudest = id;
    }
  }
  if (!loudest || loudest === current.id) return current;
  if (current.id === null) return { id: loudest, since: now };
  const currentLevel = levels[current.id] ?? 0;
  const held = now - current.since >= SPEAKER_HOLD_MS;
  if (currentLevel < SPEAKING_LEVEL ? held || now - current.since >= SPEAKER_HOLD_MS / 2 : held && top > currentLevel * SPEAKER_MARGIN) {
    return { id: loudest, since: now };
  }
  return current;
}

/**
 * The camera a group class asks for: small, because in a mesh every browser
 * sends its camera to every other one (N−1 uploads). ~640×360 at 15 fps for up
 * to 3 others, 320×180 beyond.
 */
export function groupCameraConstraints(others: number): { width: { ideal: number }; height: { ideal: number }; frameRate: { ideal: number; max: number } } {
  const small = others > 3;
  return {
    width: { ideal: small ? 320 : 640 },
    height: { ideal: small ? 180 : 360 },
    frameRate: { ideal: 15, max: 15 },
  };
}
