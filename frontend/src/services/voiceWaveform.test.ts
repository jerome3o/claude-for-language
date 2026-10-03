import { describe, it, expect } from 'vitest';
import { peaks, seededBars, nextVoiceSpeed, WAVE_BARS } from './voiceWaveform';

describe('voice waveform', () => {
  it('peaks: one bar per slice, normalised to the loudest, with a floor', () => {
    const s = new Float32Array(400);
    for (let i = 0; i < 400; i++) s[i] = i < 200 ? 0 : (i % 2 ? -0.5 : 0.25);
    const p = peaks(s, 4);
    expect(p).toEqual([0.08, 0.08, 1, 1]);
    expect(peaks([], 3)).toEqual([0.08, 0.08, 0.08]);
    expect(peaks(new Float32Array(10), WAVE_BARS)).toHaveLength(WAVE_BARS);
  });

  it('seeded bars are stable per message and in range', () => {
    expect(seededBars('m1')).toEqual(seededBars('m1'));
    expect(seededBars('m1')).not.toEqual(seededBars('m2'));
    expect(seededBars('m1').every((v) => v >= 0.25 && v <= 0.85)).toBe(true);
  });

  it('speed cycles 1 → 1.5 → 2 → 1', () => {
    expect(nextVoiceSpeed(1)).toBe(1.5);
    expect(nextVoiceSpeed(1.5)).toBe(2);
    expect(nextVoiceSpeed(2)).toBe(1);
  });
});
