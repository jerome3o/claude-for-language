import { describe, expect, it } from 'vitest';
import { chatReadAloudSpeed, chatReadAloudVoice, parseVoiceGender, pickVoiceGender } from './voice';
import { DEFAULT_LESSON_VOICE } from '../lesson/voices';

const M = 'Chinese (Mandarin)_';

describe('chatReadAloudVoice', () => {
  it('maps male / female to the first voice of that gender in the shipped selection', () => {
    expect(chatReadAloudVoice({ senderGender: 'male' })).toBe(`${M}Male_Announcer`);
    expect(chatReadAloudVoice({ senderGender: 'female' })).toBe(`${M}News_Anchor`);
  });

  it('uses the app voice for other / not set', () => {
    expect(chatReadAloudVoice({ senderGender: 'other' })).toBe(DEFAULT_LESSON_VOICE);
    expect(chatReadAloudVoice({ senderGender: null })).toBe(DEFAULT_LESSON_VOICE);
    expect(chatReadAloudVoice({ senderGender: undefined })).toBe(DEFAULT_LESSON_VOICE);
  });

  it("follows the listener's own selection (catalogue order)", () => {
    const enabled = ['presenter_male', 'audiobook_female_1', `${M}Gentleman`, 'presenter_female'];
    expect(chatReadAloudVoice({ senderGender: 'female', enabled })).toBe('presenter_female');
    expect(chatReadAloudVoice({ senderGender: 'male', enabled })).toBe('presenter_male');
  });

  it('never picks the legacy female-yujie default for a human chat', () => {
    for (const g of ['male', 'female', 'other', null] as const) {
      expect(chatReadAloudVoice({ senderGender: g, personaVoice: 'female-yujie' })).not.toBe('female-yujie');
    }
  });

  it("keeps a role-play chat's persona voice for Claude's lines only", () => {
    expect(chatReadAloudVoice({ senderGender: null, fromAi: true, personaVoice: `${M}Gentle_Youth` })).toBe(`${M}Gentle_Youth`);
    expect(chatReadAloudVoice({ senderGender: null, fromAi: true, personaVoice: 'not-a-voice' })).toBe(DEFAULT_LESSON_VOICE);
    expect(chatReadAloudVoice({ senderGender: 'female', fromAi: false, personaVoice: `${M}Gentle_Youth` })).toBe(`${M}News_Anchor`);
  });

  it('falls back when the selection is too small to use', () => {
    expect(chatReadAloudVoice({ senderGender: 'male', enabled: ['junk'] })).toBe(`${M}Male_Announcer`);
  });
});

describe('chatReadAloudSpeed', () => {
  it('is the card speed unless Claude speaks with a valid persona speed', () => {
    expect(chatReadAloudSpeed({})).toBe(0.6);
    expect(chatReadAloudSpeed({ fromAi: false, personaSpeed: 1 })).toBe(0.6);
    expect(chatReadAloudSpeed({ fromAi: true, personaSpeed: 1 })).toBe(1);
    expect(chatReadAloudSpeed({ fromAi: true, personaSpeed: 9 })).toBe(0.6);
  });
});

describe('voice gender values', () => {
  it('parses and validates', () => {
    expect(parseVoiceGender('male')).toBe('male');
    expect(parseVoiceGender('MALE')).toBeNull();
    expect(pickVoiceGender(undefined)).toEqual({});
    expect(pickVoiceGender(null)).toEqual({ value: null });
    expect(pickVoiceGender('')).toEqual({ value: null });
    expect(pickVoiceGender('other')).toEqual({ value: 'other' });
    expect(pickVoiceGender('x').problem).toMatch(/male, female, other/);
  });
});
