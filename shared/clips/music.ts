/**
 * 🎬 The music under a clip (docs/CLIPS.md "Music"): a chill lo-fi beat — soft kick / snare /
 * swung hats, a round bass, warm electric-piano chords and a little vinyl crackle, ~85–92 BPM —
 * not the sleepy lesson pad. Three loops, made procedurally by
 * `scripts/audio/generate-clip-music.mjs` (no samples, CC0, written for this app); each clip gets
 * one by its theme. The music ducks under every voice line, is on by default, has its own toggle
 * (♪ on the rail), and the 🔇 mute silences everything.
 *
 * Pure; the Lab port is core `clips/ClipMusic.kt`, parity-tested (parity/fixtures/clips.ts).
 */
import type { ClipTheme } from './types';

export interface ClipMusicTrack {
  id: string;
  /** Web: served from frontend/public (precached, so it plays offline). */
  path: string;
  /** Lab: the res/raw resource name. */
  raw: string;
  bpm: number;
  /** A short name for the rail's label. */
  name: string;
}

/** Bump a file name when its track changes (the web precache + Lab res/raw follow it). */
export const CLIP_MUSIC_TRACKS: readonly ClipMusicTrack[] = [
  { id: 'clip-beat-cafe-v1', path: '/audio/clip-beat-cafe-v1.mp3', raw: 'clip_beat_cafe', bpm: 88, name: 'Café' },
  { id: 'clip-beat-nightbus-v1', path: '/audio/clip-beat-nightbus-v1.mp3', raw: 'clip_beat_nightbus', bpm: 92, name: 'Night bus' },
  { id: 'clip-beat-rain-v1', path: '/audio/clip-beat-rain-v1.mp3', raw: 'clip_beat_rain', bpm: 85, name: 'Rain' },
];

/** Which loop goes with a theme: brighter themes the bouncier one, warm / quiet themes the slow one. */
const THEME_TRACK: Record<ClipTheme, number> = {
  neon: 1,
  retro: 1,
  comic: 1,
  paper: 0,
  chalk: 0,
  mono: 0,
  sunset: 2,
  ink: 2,
};

export function clipMusicFor(theme: string | null | undefined): ClipMusicTrack {
  const i = theme && theme in THEME_TRACK ? THEME_TRACK[theme as ClipTheme] : 0;
  return CLIP_MUSIC_TRACKS[i];
}

/** The music's volume under the clip (0–1): quiet, and lower still while a voice line plays. */
export const CLIP_MUSIC_VOLUME = 0.22;
export const CLIP_MUSIC_DUCKED = 0.07;
/** How fast the duck moves (volume units per second): ~0.2 s down, ~0.4 s back up. */
export const CLIP_MUSIC_DUCK_DOWN_PER_S = 0.75;
export const CLIP_MUSIC_DUCK_UP_PER_S = 0.375;

/** The volume the music is heading for right now. */
export function clipMusicTarget(state: { speaking: boolean }): number {
  return state.speaking ? CLIP_MUSIC_DUCKED : CLIP_MUSIC_VOLUME;
}

/** One step of the duck: from `current` toward `target` over `dtMs` (3 decimals). */
export function clipMusicStep(current: number, target: number, dtMs: number): number {
  const rate = target < current ? CLIP_MUSIC_DUCK_DOWN_PER_S : CLIP_MUSIC_DUCK_UP_PER_S;
  const step = (rate * Math.max(0, dtMs)) / 1000;
  const next = target < current ? Math.max(target, current - step) : Math.min(target, current + step);
  return Math.round(next * 1000) / 1000;
}

/** Whether the music plays: a clip playing, sound on and music on. */
export function clipMusicShouldPlay(state: { playing: boolean; muted: boolean; music: boolean }): boolean {
  return state.playing && !state.muted && state.music;
}
