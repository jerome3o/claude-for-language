import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_VOICES,
  CONVERSATION_TTS_SPEED,
  CONVERSATION_LINE_GAP_MS,
  DEFAULT_CONVERSATION_VOICE_IDS,
  DEFAULT_LESSON_VOICE,
  LESSON_VOICE_IDS,
  conversationSeed,
  conversationVoice,
  conversationVoicePools,
  conversationVoicesFor,
  resolveConversationVoices,
  validateConversationVoiceSelection,
} from './voices';
import type { ConversationSpeaker } from './types';

const F = 'Chinese (Mandarin)_News_Anchor';
const F2 = 'presenter_female';
const M = 'Chinese (Mandarin)_Male_Announcer';
const M2 = 'presenter_male';
const pair: ConversationSpeaker[] = [{ name: 'A', voice: 'female' }, { name: 'B', voice: 'male' }];

describe('the voice catalogue', () => {
  it('has unique ids, and every default-on voice is newsreader / neutral / warm', () => {
    expect(new Set(CONVERSATION_VOICES.map(v => v.id)).size).toBe(CONVERSATION_VOICES.length);
    for (const v of CONVERSATION_VOICES.filter(x => x.default_on)) {
      expect(['newsreader', 'neutral', 'warm']).toContain(v.style);
      expect(v.accent).toBe('standard');
      expect(v.age).not.toBe('child');
    }
  });
  it('ships the breathy / sweet / role-play female voices off', () => {
    for (const id of ['Sweet_Lady', 'Warm_Bestie', 'Soft_Girl', 'Wise_Women', 'Cute_Spirit']) {
      expect(conversationVoice(`Chinese (Mandarin)_${id}`)?.default_on).toBe(false);
    }
    expect(conversationVoice('female-yujie')?.default_on).toBe(false);
  });
  it('ships at least two voices of each gender on', () => {
    const pools = conversationVoicePools(null);
    expect(pools.female.length).toBeGreaterThanOrEqual(2);
    expect(pools.male.length).toBeGreaterThanOrEqual(2);
    expect([...pools.female, ...pools.male].sort()).toEqual([...DEFAULT_CONVERSATION_VOICE_IDS].sort());
  });
  it('lets the TTS endpoint speak every catalogue voice and the default voice', () => {
    for (const v of CONVERSATION_VOICES) expect(LESSON_VOICE_IDS.has(v.id)).toBe(true);
    expect(LESSON_VOICE_IDS.has(DEFAULT_LESSON_VOICE)).toBe(true);
    expect(LESSON_VOICE_IDS.has('Chinese (Mandarin)_Made_Up')).toBe(false);
  });
  it('plays conversations at 0.9 with a short turn-taking gap', () => {
    expect(CONVERSATION_TTS_SPEED).toBe(0.9);
    expect(CONVERSATION_LINE_GAP_MS).toBeLessThanOrEqual(250);
  });
});

describe('picking voices from the enabled pool', () => {
  it('only uses enabled voices, one per gender as asked', () => {
    for (let seed = 0; seed < 50; seed++) {
      const [f, m] = resolveConversationVoices(pair, { enabled: [F, F2, M, M2], seed });
      expect([F, F2]).toContain(f);
      expect([M, M2]).toContain(m);
    }
  });
  it('drops unknown ids from a selection', () => {
    expect(conversationVoicePools(['nope', F, M])).toEqual({ female: [F], male: [M] });
  });
  it('always gives two speakers two different voices', () => {
    const same: ConversationSpeaker[] = [{ name: 'A', voice: 'female' }, { name: 'B', voice: 'female' }];
    for (let seed = 0; seed < 50; seed++) {
      const voices = resolveConversationVoices(same, { enabled: [F, F2, M], seed });
      expect(new Set(voices).size).toBe(2);
      expect(voices.sort()).toEqual([F, F2].sort());
    }
  });
  it('pairs two voices of the same gender when only one gender is on', () => {
    const voices = resolveConversationVoices(pair, { enabled: [M, M2], seed: 7 });
    expect(new Set(voices).size).toBe(2);
    expect(voices.sort()).toEqual([M, M2].sort());
  });
  it('borrows from the other gender before repeating a voice', () => {
    const same: ConversationSpeaker[] = [{ name: 'A', voice: 'female' }, { name: 'B', voice: 'female' }];
    const voices = resolveConversationVoices(same, { enabled: [F, M] });
    expect(voices).toEqual([F, M]);
  });
  it('falls back to the shipped defaults when the pool is too small', () => {
    expect(conversationVoicePools([F])).toEqual(conversationVoicePools(null));
    expect(conversationVoicePools([])).toEqual(conversationVoicePools(null));
    expect(conversationVoicePools(['unknown-a', 'unknown-b'])).toEqual(conversationVoicePools(null));
    const voices = resolveConversationVoices(pair, { enabled: [F] });
    expect(new Set(voices).size).toBe(2);
    for (const v of voices) expect(DEFAULT_CONVERSATION_VOICE_IDS).toContain(v);
  });
  it('repeats a voice only when there are more speakers than voices', () => {
    const three: ConversationSpeaker[] = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const voices = resolveConversationVoices(three, { enabled: [F, M] });
    expect(voices).toHaveLength(3);
    expect(new Set(voices.slice(0, 2)).size).toBe(2);
  });
  it('rotates voices between dialogues but keeps one dialogue stable', () => {
    const a = { situation: 'At the hotel', speakers: pair, lines: [{ speaker: 0, hanzi: '您好' }] };
    const b = { situation: 'At the bank', speakers: pair, lines: [{ speaker: 0, hanzi: '您好' }] };
    expect(conversationSeed(a)).toBe(conversationSeed({ ...a }));
    expect(conversationSeed(a)).not.toBe(conversationSeed(b));
    expect(conversationVoicesFor(a)).toEqual(conversationVoicesFor(a));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(conversationVoicesFor({ ...a, situation: `Scene ${i}` })[0]);
    expect(seen.size).toBeGreaterThan(1);
  });
  it('treats an unknown gender like an unspecified one (alternating)', () => {
    const voices = resolveConversationVoices([{ name: 'A', voice: 'robot' as never }, { name: 'B' }], { enabled: [F, M] });
    expect(voices).toEqual([F, M]);
  });
});

describe('validating a selection', () => {
  it('accepts known ids with both genders, deduplicated, in catalogue order', () => {
    expect(validateConversationVoiceSelection([M, F, M])).toEqual({ enabled: [F, M], problems: [] });
  });
  it('refuses a selection without a female or a male voice', () => {
    expect(validateConversationVoiceSelection([M, M2]).problems).toEqual(['Keep at least one female voice on']);
    expect(validateConversationVoiceSelection([F]).problems).toEqual(['Keep at least one male voice on']);
  });
  it('refuses unknown ids and non-arrays', () => {
    expect(validateConversationVoiceSelection([F, M, 'Chinese (Mandarin)_Nope', 3]).problems).toEqual([
      'Unknown voice: Chinese (Mandarin)_Nope',
      'Unknown voice: 3',
    ]);
    expect(validateConversationVoiceSelection('all').problems[0]).toMatch(/array/);
  });
});
