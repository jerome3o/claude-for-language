import { describe, it, expect } from 'vitest';
import {
  clampConversationRate,
  conversationSpeedSteps,
  conversationProviderVoices,
  conversationVoiceProvider,
  deliveryParams,
  supportedDeliveries,
  providerVoicePools,
  AZURE_VOICE_STYLES,
} from './conversation';
import { DEFAULT_TTS_CONFIG, PROVIDER_RATE_RANGE, mergeTtsConfig, TTS_PROVIDERS } from './config';

describe('conversation speed', () => {
  it('clamps to each provider\'s natural-sounding range', () => {
    expect(clampConversationRate('azure', 0.5)).toBe(0.6);
    expect(clampConversationRate('azure', 0.75)).toBe(0.75);
    expect(clampConversationRate('minimax', 0.5)).toBe(0.5);
    expect(clampConversationRate('google', 0.3)).toBe(0.6);
    expect(clampConversationRate('minimax', 3)).toBe(1.2);
    expect(clampConversationRate('azure', Number.NaN)).toBe(0.8);
    expect(clampConversationRate('azure', 0.777)).toBe(0.78);
  });
  it('offers only the steps a provider speaks well', () => {
    expect(conversationSpeedSteps('minimax')).toEqual([0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1]);
    expect(conversationSpeedSteps('azure')).toEqual([0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1]);
  });
  it('defaults every provider to clearly-slower-than-native, Azure slowest', () => {
    for (const p of TTS_PROVIDERS) {
      const rate = DEFAULT_TTS_CONFIG.providers[p].conversation_rate;
      expect(rate).toBeLessThan(0.9);
      expect(rate).toBeGreaterThanOrEqual(PROVIDER_RATE_RANGE[p].good_min);
    }
    expect(DEFAULT_TTS_CONFIG.providers.azure.conversation_rate).toBe(0.75);
    // Card clips are untouched.
    expect(DEFAULT_TTS_CONFIG.providers.azure.speed_factor).toBe(0.75);
  });
  it('validates the admin conversation rate', () => {
    expect(mergeTtsConfig(DEFAULT_TTS_CONFIG, { providers: { azure: { conversation_rate: 0.8 } } }).config.providers.azure.conversation_rate).toBe(0.8);
    expect(mergeTtsConfig(DEFAULT_TTS_CONFIG, { providers: { azure: { conversation_rate: 0.4 } } }).problems).toEqual([
      'providers.azure.conversation_rate must be between 0.6 and 1.2',
    ]);
  });
});

describe('conversation voices per provider', () => {
  it('leaves out HD voices (own pace, some regions only)', () => {
    expect(conversationProviderVoices('azure').some(v => v.id.includes(':'))).toBe(false);
    expect(conversationProviderVoices('azure').length).toBe(6);
  });
  it('knows which provider owns a voice id', () => {
    expect(conversationVoiceProvider('zh-CN-YunxiNeural')).toBe('azure');
    expect(conversationVoiceProvider('cmn-CN-Wavenet-B')).toBe('google');
    expect(conversationVoiceProvider('presenter_male')).toBe('minimax');
    expect(conversationVoiceProvider('zh-CN-Xiaoxiao:DragonHDFlashLatestNeural')).toBeNull();
    expect(conversationVoiceProvider('nope')).toBeNull();
  });
  it('pools both genders for every provider', () => {
    for (const p of TTS_PROVIDERS) {
      const pools = providerVoicePools(p);
      expect(pools.female.length).toBeGreaterThanOrEqual(2);
      expect(pools.male.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('delivery', () => {
  it('maps to an Azure style the voice really has', () => {
    expect(deliveryParams('azure', 'zh-CN-XiaoxiaoNeural', 'calm')).toEqual({ azure_style: 'calm' });
    expect(deliveryParams('azure', 'zh-CN-YunxiNeural', 'calm')).toEqual({ azure_style: 'narration-relaxed' });
    expect(deliveryParams('azure', 'zh-CN-XiaoyiNeural', 'calm')).toEqual({ azure_style: 'gentle' });
    expect(deliveryParams('azure', 'zh-CN-YunxiNeural', 'chat')).toEqual({ azure_style: 'chat' });
    expect(deliveryParams('azure', 'zh-CN-XiaochenNeural', 'cheerful')).toBeNull();
    for (const [voice, styles] of Object.entries(AZURE_VOICE_STYLES)) {
      for (const d of supportedDeliveries('azure', voice)) {
        const p = deliveryParams('azure', voice, d);
        if (p) expect(styles).toContain(p.azure_style);
      }
    }
  });
  it('maps to MiniMax emotions; Google and natural have none', () => {
    expect(deliveryParams('minimax', 'presenter_male', 'cheerful')).toEqual({ minimax_emotion: 'happy' });
    expect(deliveryParams('minimax', 'presenter_male', 'calm')).toEqual({ minimax_emotion: 'calm' });
    expect(deliveryParams('minimax', 'presenter_male', 'chat')).toBeNull();
    expect(deliveryParams('google', 'cmn-CN-Wavenet-B', 'calm')).toBeNull();
    expect(deliveryParams('azure', 'zh-CN-XiaoxiaoNeural', 'natural')).toBeNull();
    expect(supportedDeliveries('google', 'cmn-CN-Wavenet-B')).toEqual(['natural']);
  });
});
