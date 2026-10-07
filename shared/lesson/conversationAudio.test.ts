import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONVERSATION_AUDIO_PREFS,
  MAX_EXERCISE_VOICE_ENTRIES,
  conversationAudioKey,
  mergeConversationAudioPrefs,
  parseConversationAudioPrefs,
  resolveConversationAudio,
  speakerVoiceUpdate,
  type ConversationAudioPrefs,
} from './conversationAudio';
import { conversationVoicesFor } from './voices';

const ex = {
  situation: 'At the station',
  speakers: [{ name: '小王', voice: 'female' as const }, { name: '李先生', voice: 'male' as const }],
  lines: [{ speaker: 0, hanzi: '你好！' }, { speaker: 1, hanzi: '你好，请问去哪儿？' }],
};
const three = { ...ex, speakers: [...ex.speakers, { name: '小李', voice: 'female' as const }], lines: [...ex.lines, { speaker: 2, hanzi: '我也去。' }] };

function merged(update: unknown, base: ConversationAudioPrefs = DEFAULT_CONVERSATION_AUDIO_PREFS) {
  const r = mergeConversationAudioPrefs(base, update);
  expect(r.problems).toEqual([]);
  return r.prefs;
}

describe('preferences', () => {
  it('validates speed, delivery and voices', () => {
    expect(merged({ speed: 0.7, delivery: 'calm' })).toMatchObject({ speed: 0.7, delivery: 'calm' });
    expect(mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, { speed: 0.3 }).problems).toHaveLength(1);
    expect(mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, { delivery: 'sultry' }).problems).toHaveLength(1);
    expect(mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, { voices: { azure: { female: 'zh-CN-YunxiNeural' } } }).problems[0]).toContain('not a female azure');
    expect(mergeConversationAudioPrefs(DEFAULT_CONVERSATION_AUDIO_PREFS, { voices: { azure: { male: 'presenter_male' } } }).problems).toHaveLength(1);
    expect(merged({ speed: 0.7 }, merged({ speed: 0.9 }))).toMatchObject({ speed: 0.7 });
    expect(merged({ speed: null }, merged({ speed: 0.9 })).speed).toBeNull();
  });
  it('merges voices and conversation choices key by key, null removes', () => {
    let p = merged({ voices: { azure: { female: 'zh-CN-XiaochenNeural' } } });
    p = merged({ voices: { azure: { male: 'zh-CN-YunjianNeural' } } }, p);
    expect(p.voices.azure).toEqual({ female: 'zh-CN-XiaochenNeural', male: 'zh-CN-YunjianNeural' });
    p = merged({ voices: { azure: { female: null } } }, p);
    expect(p.voices.azure).toEqual({ male: 'zh-CN-YunjianNeural' });
    p = merged({ exercise_voices: { 'azure:abc': ['zh-CN-XiaoyiNeural', null] } }, p);
    p = merged({ exercise_voices: { 'azure:def': [null, 'zh-CN-YunxiNeural'] } }, p);
    expect(Object.keys(p.exercise_voices)).toEqual(['azure:abc', 'azure:def']);
    p = merged({ exercise_voices: { 'azure:abc': null } }, p);
    expect(Object.keys(p.exercise_voices)).toEqual(['azure:def']);
    expect(mergeConversationAudioPrefs(p, { exercise_voices: { 'azure:x': ['presenter_male'] } }).problems).toHaveLength(1);
    expect(mergeConversationAudioPrefs(p, { exercise_voices: { 'bad key': [] } }).problems).toHaveLength(1);
  });
  it('keeps only the newest conversation choices', () => {
    let p = DEFAULT_CONVERSATION_AUDIO_PREFS;
    for (let i = 0; i < MAX_EXERCISE_VOICE_ENTRIES + 5; i++) p = merged({ exercise_voices: { [`azure:k${i.toString(36)}`]: ['zh-CN-XiaoyiNeural'] } }, p);
    const keys = Object.keys(p.exercise_voices);
    expect(keys).toHaveLength(MAX_EXERCISE_VOICE_ENTRIES);
    expect(keys[0]).toBe('azure:k5');
  });
  it('parses a stored row, dropping bad parts', () => {
    expect(parseConversationAudioPrefs(null)).toEqual(DEFAULT_CONVERSATION_AUDIO_PREFS);
    expect(parseConversationAudioPrefs('nope')).toEqual(DEFAULT_CONVERSATION_AUDIO_PREFS);
    expect(parseConversationAudioPrefs(JSON.stringify({ speed: 9, delivery: 'calm' }))).toMatchObject({ speed: null, delivery: 'calm' });
  });
});

describe('resolving a conversation', () => {
  it('keeps the MiniMax rotation when nothing is chosen', () => {
    const r = resolveConversationAudio(ex, { provider: 'minimax', default_speed: 0.85 });
    expect(r.voices).toEqual(conversationVoicesFor(ex));
    expect(r.speed).toBe(0.85);
    expect(r.delivery).toBe('natural');
    expect(r.chosen).toEqual([false, false]);
  });
  it('speaks another provider\'s own voices, distinct, by gender', () => {
    const r = resolveConversationAudio(three, { provider: 'azure', default_speed: 0.75 });
    expect(new Set(r.voices).size).toBe(3);
    expect(r.voices[1]).toMatch(/^zh-CN-Yun/);
    expect(r.voices[0]).toMatch(/^zh-CN-Xiao/);
    expect(r.voices[2]).toMatch(/^zh-CN-Xiao/);
  });
  it('uses the learner speed, clamped for the provider', () => {
    const prefs = merged({ speed: 0.5 });
    expect(resolveConversationAudio(ex, { provider: 'azure', default_speed: 0.75, prefs }).speed).toBe(0.6);
    expect(resolveConversationAudio(ex, { provider: 'minimax', default_speed: 0.85, prefs }).speed).toBe(0.5);
  });
  it('gives the first speaker of a gender the preferred voice, a conversation choice wins', () => {
    let prefs = merged({ voices: { azure: { female: 'zh-CN-XiaoyiNeural' } } });
    let r = resolveConversationAudio(three, { provider: 'azure', default_speed: 0.75, prefs });
    expect(r.voices[0]).toBe('zh-CN-XiaoyiNeural');
    expect(r.voices[2]).not.toBe('zh-CN-XiaoyiNeural');
    expect(r.chosen).toEqual([true, false, false]);
    const key = `azure:${conversationAudioKey(three)}`;
    prefs = merged({ exercise_voices: { [key]: [null, null, 'zh-CN-XiaoyiNeural'] } }, prefs);
    r = resolveConversationAudio(three, { provider: 'azure', default_speed: 0.75, prefs });
    expect(r.voices[2]).toBe('zh-CN-XiaoyiNeural');
    expect(r.voices[0]).not.toBe('zh-CN-XiaoyiNeural');
    // Another provider's choices are ignored.
    expect(resolveConversationAudio(three, { provider: 'minimax', default_speed: 0.85, prefs }).voices).toEqual(conversationVoicesFor(three));
  });
  it('builds the update for one speaker\'s voice', () => {
    const r = resolveConversationAudio(three, { provider: 'azure', default_speed: 0.75 });
    const key = `azure:${r.key}`;
    expect(speakerVoiceUpdate(r, three.speakers, 0, 'zh-CN-XiaochenNeural')).toEqual({
      exercise_voices: { [key]: ['zh-CN-XiaochenNeural', null, null] },
      voices: { azure: { female: 'zh-CN-XiaochenNeural' } },
    });
    expect(speakerVoiceUpdate(r, three.speakers, 2, 'zh-CN-XiaochenNeural')).toEqual({
      exercise_voices: { [key]: [null, null, 'zh-CN-XiaochenNeural'] },
    });
    expect(speakerVoiceUpdate(r, three.speakers, 2, null)).toEqual({ exercise_voices: { [key]: null } });
  });
});
