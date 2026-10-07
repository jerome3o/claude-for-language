import { describe, it, expect, beforeEach } from 'vitest';
import { conversationClipKey, ttsCacheKey } from './ttsCache';
import { applyConversationAudioUpdate, audioForConversation, readConversationAudio, writeConversationAudio } from './conversationAudio';

const ex = {
  situation: 'Buying tea',
  speakers: [{ name: 'A', voice: 'female' as const }, { name: 'B', voice: 'male' as const }],
  lines: [{ speaker: 0, hanzi: '你要什么茶？' }, { speaker: 1, hanzi: '绿茶，谢谢。' }],
};

describe('conversation clip keys on the device', () => {
  it('differ by speed, voice and delivery, and never collide with card clips', () => {
    const base = { text: '你好', voice: 'zh-CN-YunxiNeural', speed: 0.75, delivery: 'natural' as const };
    const keys = new Set([
      conversationClipKey(base),
      conversationClipKey({ ...base, speed: 0.8 }),
      conversationClipKey({ ...base, voice: 'zh-CN-YunjianNeural' }),
      conversationClipKey({ ...base, delivery: 'calm' }),
      ttsCacheKey('你好', 0.75, 'zh-CN-YunxiNeural'),
    ]);
    expect(keys.size).toBe(5);
    expect(conversationClipKey(base)).toBe(conversationClipKey({ ...base }));
  });
});

describe('device preferences', () => {
  beforeEach(() => localStorage.clear());
  it('falls back to MiniMax defaults before the server has answered', () => {
    expect(readConversationAudio()).toMatchObject({ provider: 'minimax', default_speed: 0.85 });
  });
  it('resolves with the cached provider and applies local updates at once', () => {
    writeConversationAudio({ provider: 'azure', default_speed: 0.75, prefs: { speed: null, delivery: 'natural', voices: {}, exercise_voices: {} } });
    let audio = audioForConversation(ex);
    expect(audio.speed).toBe(0.75);
    expect(audio.voices[1]).toMatch(/^zh-CN-Yun/);
    applyConversationAudioUpdate({ speed: 0.6, voices: { azure: { male: 'zh-CN-YunyangNeural' } } });
    audio = audioForConversation(ex);
    expect(audio.speed).toBe(0.6);
    expect(audio.voices[1]).toBe('zh-CN-YunyangNeural');
  });
});
