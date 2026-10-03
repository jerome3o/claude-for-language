import { describe, expect, it } from 'vitest';
import { pickChineseVoiceFrom } from './audioCache';

const voices = [
  { name: 'Google US English', lang: 'en-US', localService: true },
  { name: 'Microsoft Tracy - Chinese (Hong Kong)', lang: 'zh-HK', localService: true },
  { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
  { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
  { name: 'cmn-cn-x-cce-local', lang: 'zh-CN', localService: false },
];

describe('pickChineseVoiceFrom', () => {
  it('picks a mainland Mandarin voice of the asked gender', () => {
    expect(pickChineseVoiceFrom(voices, 'male')?.name).toMatch(/Kangkang/);
    expect(pickChineseVoiceFrom(voices, 'female')?.name).toMatch(/Huihui/);
  });

  it('falls back to any zh-CN voice, never a non-Chinese one', () => {
    expect(pickChineseVoiceFrom(voices.filter((v) => !/Kangkang/.test(v.name)), 'male')?.lang).toBe('zh-CN');
    expect(pickChineseVoiceFrom([voices[0]], 'male')).toBeUndefined();
  });
});
