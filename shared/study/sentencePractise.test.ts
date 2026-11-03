import { describe, it, expect } from 'vitest';
import {
  sentencePractiseMode, sentenceTake, sentencePractiseResult, sentencePractiseVia, showCheckOnline,
  sentenceAnswerCheckInput, sentenceGate, sentenceGateLabel, sentenceStopBar,
  SENTENCE_GATE_TARGET,
} from './sentencePractise';

describe('sentencePractiseMode', () => {
  it('reads a row whose Chinese is up, translates an English-first row with the Chinese hidden', () => {
    expect(sentencePractiseMode({ englishFirst: false, hanziShown: false, translation: 'x' })).toBeNull();
    expect(sentencePractiseMode({ englishFirst: false, hanziShown: true, translation: null })).toBe('read');
    expect(sentencePractiseMode({ englishFirst: true, hanziShown: false, translation: 'I go to the bank.' })).toBe('translate');
    expect(sentencePractiseMode({ englishFirst: true, hanziShown: true, translation: 'I go.' })).toBe('read');
    expect(sentencePractiseMode({ englishFirst: true, hanziShown: false, translation: '  ' })).toBeNull();
  });
});

describe('sentenceTake', () => {
  it('judges a read take like the Coach practise (homophones right, tones close)', () => {
    const t = sentenceTake('read', '我去银行。', '我去银行。');
    expect(t.practised.result.state).toBe('match');
    expect(t.askClaude).toBe(false);
    expect(sentencePractiseResult(t.practised, null)).toBe('right');
    expect(sentencePractiseVia(t, false)).toBe('local');
    const close = sentenceTake('read', '我去', '我去银行');
    expect(close.askClaude).toBe(false);
    expect(['close', 'wrong']).toContain(sentencePractiseResult(close.practised, null));
  });
  it('asks Claude about a translate take that is not the sentence', () => {
    const t = sentenceTake('translate', '我要去银行', '我去银行。');
    expect(t.askClaude).toBe(true);
    expect(sentencePractiseResult(t.practised, 'acceptable')).toBe('right');
    expect(sentencePractiseResult(t.practised, 'almost')).toBe('close');
    expect(sentencePractiseResult(t.practised, 'wrong')).toBe('wrong');
    expect(sentencePractiseVia(t, true)).toBe('claude');
    expect(sentencePractiseVia(t, false)).toBe('offline');
    expect(showCheckOnline(t, false, false)).toBe(true);
    expect(showCheckOnline(t, false, true)).toBe(false);
    expect(showCheckOnline(t, true, false)).toBe(false);
  });
  it('never asks Claude about a right translate take or one with no Chinese', () => {
    expect(sentenceTake('translate', '我去银行', '我去银行。').askClaude).toBe(false);
    expect(sentenceTake('translate', 'hello', '我去银行。').askClaude).toBe(false);
  });
  it('reports failed / empty takes', () => {
    expect(sentencePractiseResult(null, null, 'empty')).toBe('empty');
    expect(sentencePractiseResult(null, null, 'failed')).toBe('failed');
    expect(sentencePractiseResult(null, null, null)).toBe('failed');
  });
  it('builds the spoken translate check', () => {
    expect(sentenceAnswerCheckInput({ hanzi: '我去银行。', pinyin: ' wǒ qù yínháng ', translation: ' I go to the bank. ' }, '我要去银行')).toEqual({
      prompt_en: 'I go to the bank.', model_answer: '我去银行。', model_pinyin: 'wǒ qù yínháng', answer: '我要去银行', exercise_type: 'translate', input: 'spoken',
    });
    expect(sentenceAnswerCheckInput({ hanzi: '好', pinyin: null, translation: 'Good' }, '好').model_pinyin).toBeUndefined();
  });
});

describe('sentenceGate', () => {
  const base = { enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: 6, rightKeys: [] as string[] };
  it('locks Good / Easy until two sentences are right', () => {
    expect(sentenceGate(base)).toEqual({ needed: 2, got: 0, locked: true });
    expect(sentenceGate({ ...base, rightKeys: ['a', 'a'] })).toEqual({ needed: 2, got: 1, locked: true });
    expect(sentenceGate({ ...base, rightKeys: ['a', 'b', 'c'] })).toEqual({ needed: 2, got: 2, locked: false });
  });
  it('asks for as many as exist, none when there are none', () => {
    expect(sentenceGate({ ...base, sentenceCount: 1 }).needed).toBe(1);
    expect(sentenceGate({ ...base, sentenceCount: 0 })).toEqual({ needed: 0, got: 0, locked: false });
    expect(sentenceGate({ ...base, sentenceCount: null }).needed).toBe(SENTENCE_GATE_TARGET);
  });
  it('gates the reading, meaning and listening cards, only when on', () => {
    expect(sentenceGate({ ...base, cardType: 'meaning_to_hanzi' }).locked).toBe(true);
    expect(sentenceGate({ ...base, cardType: 'audio_to_hanzi' }).needed).toBe(2);
    expect(sentenceGate({ ...base, cardType: 'other' }).needed).toBe(0);
    expect(sentenceGate({ ...base, enabled: false }).needed).toBe(0);
  });
  it('words the line', () => {
    expect(sentenceGateLabel(sentenceGate({ ...base, rightKeys: ['a'] }))).toBe('🎤 Try the sentences first · 1/2 right');
    expect(sentenceGateLabel(sentenceGate({ ...base, sentenceCount: 1 }))).toBe('🎤 Try the sentences first · 0/1 right');
    expect(sentenceGateLabel(sentenceGate({ ...base, rightKeys: ['a', 'b'] }))).toBe('✓ 2/2 right — Good and Easy unlocked');
    expect(sentenceGateLabel(sentenceGate({ ...base, enabled: false }))).toBeNull();
  });
});

describe('stopping a take is intentional', () => {
  it('the pinned bar: Stop while recording, Checking while judged, none otherwise', () => {
    expect(sentenceStopBar(true, false)).toBe('stop');
    expect(sentenceStopBar(false, true)).toBe('checking');
    expect(sentenceStopBar(false, false)).toBeNull();
  });
});
