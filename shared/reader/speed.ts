/**
 * The reader's playback speed: 1× · 0.75× · 0.5×, chosen with one chip in the
 * reader's audio controls and remembered per device.
 *
 * The speed is applied at PLAYBACK only — the narration clip is never
 * regenerated. Pitch is preserved (web: `preservesPitch` on the media element,
 * Android: `PlaybackParams.setSpeed(x).setPitch(1f)`, Sonic time-stretching),
 * so slowed speech sounds like slower speech, not a lower voice.
 *
 * Shared with the Lab app (android-lab core `ReaderSpeed.kt`, parity-tested by
 * parity/fixtures/reader-speed.ts).
 */

import { BLOCK_GRACE_MS } from './blockPlayback';

/** The speeds the chip cycles through, in order (tap → the next one). */
export const READER_SPEEDS = [1, 0.75, 0.5] as const;
export type ReaderSpeed = (typeof READER_SPEEDS)[number];

export const DEFAULT_READER_SPEED: ReaderSpeed = 1;

/** localStorage key (web) / JsonCache key (Lab) of the device's choice. */
export const READER_SPEED_STORAGE_KEY = 'reader-playback-speed';

/**
 * A stored value back to a speed: a number or numeric string that is exactly
 * one of READER_SPEEDS; anything else (missing, garbage, a speed we no longer
 * offer) is the default.
 */
export function parseReaderSpeed(raw: unknown): ReaderSpeed {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN;
  return (READER_SPEEDS as readonly number[]).includes(n) ? (n as ReaderSpeed) : DEFAULT_READER_SPEED;
}

/** The chip's tap: 1× → 0.75× → 0.5× → 1×. */
export function nextReaderSpeed(speed: number): ReaderSpeed {
  const i = (READER_SPEEDS as readonly number[]).indexOf(parseReaderSpeed(speed));
  return READER_SPEEDS[(i + 1) % READER_SPEEDS.length];
}

/** "1×", "0.75×", "0.5×". */
export function readerSpeedLabel(speed: number): string {
  return `${parseReaderSpeed(speed)}×`;
}

/**
 * The scrubber's 1 s grace in MEDIA time at this speed.
 *
 * The grace models a reaction: he hears the next phrase begin, realises he
 * missed the last one and taps stop — a wall-clock second, whatever the speed.
 * Positions and blocks are in media time, and at 0.5× one wall-clock second
 * covers only 500 ms of the clip, so the grace scales with the speed. (Block
 * advance itself is pure media time and needs no change.)
 */
export function blockGraceMsAt(speed: number): number {
  return Math.round(BLOCK_GRACE_MS * parseReaderSpeed(speed));
}
