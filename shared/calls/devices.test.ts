import { describe, expect, it } from 'vitest';
import { announceDevice, CAMERA_ON_AT_START, deviceOnWhenOpened } from './devices';

describe('devices: the camera starts on (round 5)', () => {
  it('the camera always comes on when it opens — a rejoin never restores "off"', () => {
    expect(CAMERA_ON_AT_START).toBe(true);
    expect(deviceOnWhenOpened('cam', true, false)).toBe(true);
    expect(deviceOnWhenOpened('cam', true, true)).toBe(true);
    expect(deviceOnWhenOpened('cam', false, true)).toBe(true);
  });

  it('the microphone keeps round 4: muted comes back muted, a tap turns it on', () => {
    expect(deviceOnWhenOpened('mic', true, true)).toBe(false);
    expect(deviceOnWhenOpened('mic', true, false)).toBe(true);
    expect(deviceOnWhenOpened('mic', false, true)).toBe(true);
  });

  it('regression (2 Oct 2026, "joining with no mic, no camera"): a device that opens while the room is still connecting is announced', () => {
    expect(announceDevice('joining')).toBe(true);
    expect(announceDevice('live')).toBe(true);
    expect(announceDevice('prejoin')).toBe(false);
    expect(announceDevice('left')).toBe(false);
    expect(announceDevice('ended')).toBe(false);
  });
});
