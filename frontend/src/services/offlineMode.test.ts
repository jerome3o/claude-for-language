import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getManualOfflineMode,
  setManualOfflineMode,
  toggleManualOfflineMode,
} from './offlineMode';
import { pickChineseVoice } from './audioCache';

describe('manual offline mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to off', () => {
    expect(getManualOfflineMode()).toBe(false);
  });

  it('persists across get/set', () => {
    setManualOfflineMode(true);
    expect(getManualOfflineMode()).toBe(true);
    expect(localStorage.getItem('manualOfflineMode')).toBe('true');

    setManualOfflineMode(false);
    expect(getManualOfflineMode()).toBe(false);
  });

  it('toggles and returns the new value', () => {
    expect(toggleManualOfflineMode()).toBe(true);
    expect(getManualOfflineMode()).toBe(true);
    expect(toggleManualOfflineMode()).toBe(false);
    expect(getManualOfflineMode()).toBe(false);
  });
});

describe('pickChineseVoice', () => {
  function mockVoices(voices: Partial<SpeechSynthesisVoice>[]) {
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices as SpeechSynthesisVoice[],
    });
  }

  it('prefers an on-device (localService) Chinese voice', () => {
    mockVoices([
      { name: 'Remote zh', lang: 'zh-CN', localService: false },
      { name: 'Local zh', lang: 'zh-CN', localService: true },
      { name: 'English', lang: 'en-US', localService: true },
    ]);
    expect(pickChineseVoice()?.name).toBe('Local zh');
  });

  it('falls back to any Chinese voice when no local one exists', () => {
    mockVoices([
      { name: 'Remote zh', lang: 'zh-TW', localService: false },
      { name: 'English', lang: 'en-US', localService: true },
    ]);
    expect(pickChineseVoice()?.name).toBe('Remote zh');
  });

  it('returns undefined when no Chinese voice exists', () => {
    mockVoices([{ name: 'English', lang: 'en-US', localService: true }]);
    expect(pickChineseVoice()).toBeUndefined();
  });
});
