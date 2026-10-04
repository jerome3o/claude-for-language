import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TTS_CONFIG,
  azureRateAttr,
  cloneTtsConfig,
  isFixedRateVoice,
  mergeTtsConfig,
  parseStoredTtsConfig,
  providerRate,
  usableOrder,
} from './config';

describe('TTS settings: defaults = the behaviour before providers', () => {
  it('stored clips MiniMax only, live MiniMax then Google, upgrade on', () => {
    expect(DEFAULT_TTS_CONFIG.stored_order).toEqual(['minimax']);
    expect(DEFAULT_TTS_CONFIG.live_order).toEqual(['minimax', 'google']);
    expect(DEFAULT_TTS_CONFIG.upgrade_backup_clips).toBe(true);
    expect(DEFAULT_TTS_CONFIG.providers.minimax.voices.default).toBe('Chinese (Mandarin)_Radio_Host');
    expect(DEFAULT_TTS_CONFIG.providers.azure.max_rpm).toBeLessThan(20); // F0: 20 requests / 60 s
  });

  it('no stored row or a broken one → the defaults, never a throw', () => {
    expect(parseStoredTtsConfig(null)).toEqual(DEFAULT_TTS_CONFIG);
    expect(parseStoredTtsConfig('{not json')).toEqual(DEFAULT_TTS_CONFIG);
    const partial = parseStoredTtsConfig(JSON.stringify({ stored_order: ['azure', 'minimax'] }));
    expect(partial.stored_order).toEqual(['azure', 'minimax']);
    expect(partial.live_order).toEqual(DEFAULT_TTS_CONFIG.live_order);
  });
});

describe('mergeTtsConfig validation', () => {
  it('accepts a full update', () => {
    const { config, problems } = mergeTtsConfig(DEFAULT_TTS_CONFIG, {
      stored_order: ['minimax', 'azure'],
      live_order: ['azure', 'google'],
      upgrade_backup_clips: false,
      providers: { azure: { enabled: true, max_rpm: 18, speed_factor: 0.8, voices: { male: 'zh-CN-YunjianNeural' } } },
    });
    expect(problems).toEqual([]);
    expect(config.stored_order).toEqual(['minimax', 'azure']);
    expect(config.upgrade_backup_clips).toBe(false);
    expect(config.providers.azure).toMatchObject({ max_rpm: 18, speed_factor: 0.8, voices: { default: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunjianNeural' } });
    // The base is never mutated.
    expect(DEFAULT_TTS_CONFIG.stored_order).toEqual(['minimax']);
  });

  it.each([
    [{ stored_order: [] }, 'stored_order needs at least one provider'],
    [{ stored_order: ['minimax', 'minimax'] }, 'stored_order: minimax is listed twice'],
    [{ live_order: ['elevenlabs'] }, 'live_order: unknown provider "elevenlabs"'],
    [{ stored_order: 'minimax' }, 'stored_order must be a list of providers'],
    [{ upgrade_backup_clips: 'yes' }, 'upgrade_backup_clips must be true or false'],
    [{ providers: { azure: { max_rpm: 0 } } }, 'providers.azure.max_rpm must be a whole number 1–600'],
    [{ providers: { azure: { max_rpm: 2.5 } } }, 'providers.azure.max_rpm must be a whole number 1–600'],
    [{ providers: { azure: { speed_factor: 3 } } }, 'providers.azure.speed_factor must be between 0 and 2'],
    [{ providers: { azure: { voices: { default: 'not a voice' } } } }, 'providers.azure.voices.default: "not a voice" is not a Azure Speech voice'],
    [{ providers: { azure: { voices: { narrator: 'zh-CN-XiaoxiaoNeural' } } } }, 'providers.azure.voices: unknown role "narrator"'],
    [{ providers: { openai: {} } }, 'providers: unknown provider "openai"'],
  ])('%j → %s', (input, problem) => {
    const { problems, config } = mergeTtsConfig(DEFAULT_TTS_CONFIG, input);
    expect(problems).toContain(problem);
    expect(config.stored_order).toEqual(['minimax']);
  });

  it('a voice outside the catalogue is fine when it looks like the provider’s ids', () => {
    expect(mergeTtsConfig(DEFAULT_TTS_CONFIG, { providers: { azure: { voices: { female: 'zh-CN-XiaomoNeural' } } } }).problems).toEqual([]);
    expect(mergeTtsConfig(DEFAULT_TTS_CONFIG, { providers: { google: { voices: { male: 'cmn-CN-Chirp3-HD-Orus' } } } }).problems).toEqual([]);
  });

  it('not an object', () => {
    expect(mergeTtsConfig(DEFAULT_TTS_CONFIG, null).problems).toEqual(['settings must be an object']);
  });
});

describe('speed mapping', () => {
  it('rate = 1 + (speed − 1) × factor, clamped and rounded', () => {
    const azure = DEFAULT_TTS_CONFIG.providers.azure;
    expect(providerRate(azure, 0.6)).toBe(0.7);
    expect(providerRate(azure, 0.9)).toBe(0.93);
    expect(providerRate(azure, 1)).toBe(1);
    expect(providerRate({ ...azure, speed_factor: 1 }, 0.6)).toBe(0.6);
    expect(providerRate({ ...azure, speed_factor: 2 }, 0.6)).toBe(0.5);
  });

  it('SSML rate attribute as a relative percentage', () => {
    expect(azureRateAttr(0.7)).toBe('-30%');
    expect(azureRateAttr(1.25)).toBe('+25%');
    expect(azureRateAttr(1)).toBe('+0%');
  });

  it('Azure HD voices have their own pace', () => {
    expect(isFixedRateVoice('azure', 'zh-CN-Xiaoxiao:DragonHDFlashLatestNeural')).toBe(true);
    expect(isFixedRateVoice('azure', 'zh-CN-XiaoxiaoNeural')).toBe(false);
  });
});

describe('usableOrder', () => {
  it('skips disabled and unconfigured providers, keeps the order', () => {
    const c = cloneTtsConfig();
    c.providers.google.enabled = false;
    expect(usableOrder(['azure', 'google', 'minimax'], c, { minimax: true, azure: true, google: true })).toEqual(['azure', 'minimax']);
    expect(usableOrder(['minimax', 'azure'], c, { minimax: true, azure: false, google: true })).toEqual(['minimax']);
  });
});
