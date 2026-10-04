import { describe, expect, it } from 'vitest';
import { DEFAULT_TTS_CONFIG, cloneTtsConfig } from '@shared/tts';
import { moveProvider, orderRows, sameTtsConfig, toggleProvider } from './ttsOrder';

describe('moveProvider', () => {
  it('swaps with the neighbour', () => {
    expect(moveProvider(['minimax', 'azure', 'google'], 'azure', -1)).toEqual(['azure', 'minimax', 'google']);
    expect(moveProvider(['minimax', 'azure', 'google'], 'azure', 1)).toEqual(['minimax', 'google', 'azure']);
  });
  it('leaves the ends and missing providers alone', () => {
    expect(moveProvider(['minimax', 'azure'], 'minimax', -1)).toEqual(['minimax', 'azure']);
    expect(moveProvider(['minimax', 'azure'], 'azure', 1)).toEqual(['minimax', 'azure']);
    expect(moveProvider(['minimax'], 'google', -1)).toEqual(['minimax']);
  });
});

describe('toggleProvider', () => {
  it('appends an included provider once', () => {
    expect(toggleProvider(['minimax'], 'azure', true)).toEqual(['minimax', 'azure']);
    expect(toggleProvider(['minimax', 'azure'], 'azure', true)).toEqual(['minimax', 'azure']);
  });
  it('removes, but never the last one', () => {
    expect(toggleProvider(['minimax', 'google'], 'minimax', false)).toEqual(['google']);
    expect(toggleProvider(['minimax'], 'minimax', false)).toEqual(['minimax']);
  });
});

describe('orderRows', () => {
  it('lists the order then the left-out providers', () => {
    expect(orderRows(['google', 'minimax'])).toEqual([
      { id: 'google', included: true, position: 1 },
      { id: 'minimax', included: true, position: 2 },
      { id: 'azure', included: false, position: null },
    ]);
  });
});

describe('sameTtsConfig', () => {
  it('detects a change', () => {
    const a = cloneTtsConfig(DEFAULT_TTS_CONFIG);
    const b = cloneTtsConfig(DEFAULT_TTS_CONFIG);
    expect(sameTtsConfig(a, b)).toBe(true);
    b.providers.azure.max_rpm = 20;
    expect(sameTtsConfig(a, b)).toBe(false);
  });
});
