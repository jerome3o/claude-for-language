/**
 * Microphone / camera on or off when a call (re)starts — round 5.
 *
 * Minghui found her camera "off" every time she joined (2–3 Oct 2026). The
 * diagnostics of those calls say "joining with no mic, no camera": her Mac's
 * camera took longer to open than join waits (JOIN_MEDIA_WAIT_MS), and when it
 * did open the room was still connecting — the web app only announced a device
 * that opened while the call was already LIVE, so the room (and so the other
 * person's screen) kept `cam: false, mic: false` from the join until she happened
 * to toggle. On top of that, round 4 remembered "camera off" across calls, so
 * switching the camera off at the end of one lesson started the next one dark.
 *
 * The rules now:
 * - The camera always starts ON — joining, rejoining, the next call of the
 *   lesson. "Off" is never remembered across calls (it is a per-call choice; a
 *   camera that stays dark by accident is worse than one that comes on).
 * - The microphone keeps round 4's behaviour: a muted mic comes back muted.
 * - A device that opens after Join is announced to the room as soon as the call
 *   has started joining (`announceDevice`), not only once it is live.
 *
 * Lab port: `core/…/calls/CallDevices.kt` (parity-tested).
 */

export type CallDevice = 'mic' | 'cam';

/**
 * On or off for a device that has just opened. `restore`: the preview / a
 * rejoin (not a tap); a tap to turn a device on always turns it on.
 * `micOff`: the mic was muted when I last left a call.
 */
export function deviceOnWhenOpened(device: CallDevice, restore: boolean, micOff: boolean): boolean {
  if (device === 'cam' || !restore) return true;
  return !micOff;
}

/** The camera at the start of a call: always on (nothing remembered). */
export const CAMERA_ON_AT_START = true;

/**
 * Must a device that opened (or changed) now be announced to the room? From the
 * moment Join was pressed until the call is over — 'joining' included, so a
 * camera that opens while the socket connects is not lost.
 */
export function announceDevice(phase: string): boolean {
  return phase === 'joining' || phase === 'live';
}
