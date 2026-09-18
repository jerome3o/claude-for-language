import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getManualOfflineMode,
  setManualOfflineMode,
  toggleManualOfflineMode,
  resolveOfflineMode,
  nextOfflineModeForced,
  cycleOfflineMode,
  isEffectivelyOffline,
} from './offlineMode';
import { pickChineseVoice } from './audioCache';

describe('resolveOfflineMode (auto vs forced)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is online when the browser is online and nothing is forced', () => {
    const mode = resolveOfflineMode({ forced: false, isOnline: true });
    expect(mode.state).toBe('auto-online');
    expect(mode.effectiveOffline).toBe(false);
    expect(mode.label).toBe('Auto · online');
  });

  it('goes offline automatically when the browser is offline', () => {
    const mode = resolveOfflineMode({ forced: false, isOnline: false });
    expect(mode.state).toBe('auto-offline');
    expect(mode.effectiveOffline).toBe(true);
    expect(mode.label).toBe('Auto · offline');
  });

  it('forced wins over an online browser (the train)', () => {
    const mode = resolveOfflineMode({ forced: true, isOnline: true });
    expect(mode.state).toBe('forced-offline');
    expect(mode.effectiveOffline).toBe(true);
    expect(mode.label).toBe('Forced offline');
  });

  it('forced stays forced while the browser is offline too', () => {
    expect(resolveOfflineMode({ forced: true, isOnline: false }).state).toBe('forced-offline');
  });

  it('a tap cycles auto → forced → auto', () => {
    expect(nextOfflineModeForced(resolveOfflineMode({ forced: false, isOnline: true }))).toBe(true);
    expect(nextOfflineModeForced(resolveOfflineMode({ forced: false, isOnline: false }))).toBe(true);
    expect(nextOfflineModeForced(resolveOfflineMode({ forced: true, isOnline: true }))).toBe(false);

    expect(cycleOfflineMode(true).state).toBe('forced-offline');
    expect(getManualOfflineMode()).toBe(true);
    expect(cycleOfflineMode(true).state).toBe('auto-online');
    expect(getManualOfflineMode()).toBe(false);
  });

  it('isEffectivelyOffline combines the flag with navigator.onLine', () => {
    const original = navigator.onLine;
    try {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      expect(isEffectivelyOffline()).toBe(false);
      setManualOfflineMode(true);
      expect(isEffectivelyOffline()).toBe(true);
      setManualOfflineMode(false);
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      expect(isEffectivelyOffline()).toBe(true);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: original, configurable: true, writable: true });
    }
  });
});

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
