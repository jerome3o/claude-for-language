import { describe, it, expect } from 'vitest';
import {
  roundSentences, pickRoundExercises, sentenceRoundOpens, sentenceRoundProgress, sentenceRoundCounter,
  sentenceRoundIntro, sentenceRoundCheer, sentenceRoundSkipNote, type RoundSentence,
} from './sentenceRound';
import { sentenceGate } from './sentencePractise';

const s = (key: string, translation: string | null = `${key} en`): RoundSentence => ({ key, hanzi: `${key}汉字`, translation });
const brief = (ex: ReturnType<typeof pickRoundExercises>) => ex.map((e) => e.id);

describe('roundSentences', () => {
  it('puts the card sentence first unless the set has it', () => {
    const set = [s('a'), s('b')];
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: '我去银行。', translation: null }, set }).map((r) => r.key)).toEqual(['clue:n', 'a', 'b']);
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: 'a汉字', translation: null }, set }).map((r) => r.key)).toEqual(['a', 'b']);
    expect(roundSentences({ clue: null, set: [] })).toEqual([]);
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: '  ', translation: 'x' }, set: [] })).toEqual([]);
  });
});

describe('pickRoundExercises', () => {
  it('spreads four different sentences easiest → hardest, read / translate alternating', () => {
    expect(brief(pickRoundExercises([s('a'), s('b'), s('c'), s('d')]))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:d']);
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => s(k))))).toEqual(['read:a', 'translate:c', 'read:e', 'translate:g']);
  });
  it('a translate sentence without English swaps with the nearest read that has one', () => {
    expect(brief(pickRoundExercises([s('a'), s('b', null), s('c'), s('d')]))).toEqual(['read:a', 'read:b', 'translate:c', 'translate:d']);
    // The clue (no English) leads and is read.
    expect(brief(pickRoundExercises([s('clue', null), s('b'), s('c'), s('d')]))).toEqual(['read:clue', 'translate:b', 'read:c', 'translate:d']);
    // No English anywhere: four reads.
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd'].map((k) => s(k, null))))).toEqual(['read:a', 'read:b', 'read:c', 'read:d']);
  });
  it('fewer than four sentences reuse the other mode', () => {
    expect(brief(pickRoundExercises([s('a'), s('b'), s('c')]))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:a']);
    expect(brief(pickRoundExercises([s('a'), s('b')]))).toEqual(['read:a', 'translate:b', 'translate:a', 'read:b']);
    expect(brief(pickRoundExercises([s('a')]))).toEqual(['read:a', 'translate:a']);
    expect(brief(pickRoundExercises([s('a', null)]))).toEqual(['read:a']);
    expect(pickRoundExercises([])).toEqual([]);
  });
});

describe('progress + the gate', () => {
  const ex = pickRoundExercises([s('a'), s('b'), s('c'), s('d')]);
  it('any two right; ids outside the round never count', () => {
    expect(sentenceRoundProgress(ex, [])).toEqual({ needed: 2, got: 0, done: false });
    expect(sentenceRoundProgress(ex, ['translate:d', 'translate:d', 'read:zzz'])).toEqual({ needed: 2, got: 1, done: false });
    expect(sentenceRoundProgress(ex, ['read:c', 'translate:b'])).toEqual({ needed: 2, got: 2, done: true });
  });
  it('one sentence needs one', () => {
    expect(sentenceRoundProgress(pickRoundExercises([s('a')]), ['translate:a'])).toEqual({ needed: 1, got: 1, done: true });
  });
  it('the round right ids unlock the answer side gate', () => {
    expect(sentenceGate({ enabled: true, cardType: 'meaning_to_hanzi', sentenceCount: 4, rightKeys: ['read:a', 'translate:b'] }).locked).toBe(false);
  });
  it('opens on the gated card types only, not when there are no sentences', () => {
    expect(sentenceRoundOpens({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: null })).toBe(true);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'meaning_to_hanzi', sentenceCount: 0 })).toBe(false);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'audio_to_hanzi', sentenceCount: 3 })).toBe(false);
    expect(sentenceRoundOpens({ enabled: false, cardType: 'hanzi_to_meaning', sentenceCount: 3 })).toBe(false);
  });
  it('words', () => {
    const p = sentenceRoundProgress(ex, ['read:a']);
    expect(sentenceRoundCounter(p)).toBe('1 / 2');
    expect(sentenceRoundIntro(p, 4)).toBe('Get any 2 of these 4 right');
    expect(sentenceRoundCheer(p)).toBe('🎉 Nice — 1 / 2');
    expect(sentenceRoundCheer(sentenceRoundProgress(ex, ['read:a', 'read:c']))).toBe('🎉 2 / 2 — Good and Easy unlocked');
    expect(sentenceRoundSkipNote(p)).toBe('Good and Easy stay locked until 1 more sentence is right — the sentences on the answer side still count.');
    expect(sentenceRoundIntro({ needed: 1, got: 0, done: false }, 1)).toBe('Get this one right');
  });
});
