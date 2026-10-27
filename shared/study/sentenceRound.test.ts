import { describe, it, expect } from 'vitest';
import {
  roundSentences, pickRoundExercises, sentenceRoundOpens, sentenceRoundProgress, sentenceRoundCounter,
  sentenceRoundIntro, sentenceRoundCheer, sentenceRoundSkipNote, roundRowMarks, orderKeysForRound, exercisesFromLog, roundEnglishShown, type RoundSentence,
} from './sentenceRound';
import { sentenceGate } from './sentencePractise';
import { wantsMoreSentences } from './sentenceHistory';

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
  it('a sentence is in at most one exercise: fewer sentences, fewer exercises', () => {
    expect(brief(pickRoundExercises([s('a'), s('b'), s('c')]))).toEqual(['read:a', 'translate:b', 'read:c']);
    expect(brief(pickRoundExercises([s('a'), s('b')]))).toEqual(['read:a', 'translate:b']);
    expect(brief(pickRoundExercises([s('a')]))).toEqual(['read:a']);
    expect(brief(pickRoundExercises([s('a', null)]))).toEqual(['read:a']);
    expect(pickRoundExercises([])).toEqual([]);
    for (let n = 1; n <= 8; n++) {
      const ex = pickRoundExercises(Array.from({ length: n }, (_, i) => s(`k${i}`, i % 3 === 0 ? null : 'x')));
      expect(new Set(ex.map((e) => e.key)).size).toBe(ex.length);
      expect(ex.length).toBe(Math.min(4, n));
    }
  });
  it('two sentences, one with English: one per mode (the one with English is translated)', () => {
    expect(brief(pickRoundExercises([s('a'), s('b', null)]))).toEqual(['translate:a', 'read:b']);
    expect(brief(pickRoundExercises([s('clue', null), s('b')]))).toEqual(['read:clue', 'translate:b']);
    expect(brief(pickRoundExercises([s('a', null), s('b', null)]))).toEqual(['read:a', 'read:b']);
  });
  it('needs min(2, exercises) right; fewer than four visible asks for more (few)', () => {
    expect(sentenceRoundProgress(pickRoundExercises([s('a'), s('b'), s('c')]), [])).toEqual({ needed: 2, got: 0, done: false });
    expect(sentenceRoundProgress(pickRoundExercises([s('a'), s('b')]), ['read:a'])).toEqual({ needed: 2, got: 1, done: false });
    expect(sentenceRoundProgress(pickRoundExercises([s('a')]), ['read:a'])).toEqual({ needed: 1, got: 1, done: true });
    expect(wantsMoreSentences([s('a'), s('b'), s('c')], new Map())).toBe(true);
    expect(wantsMoreSentences([s('a'), s('b'), s('c'), s('d')], new Map())).toBe(false);
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
    expect(sentenceRoundProgress(pickRoundExercises([s('a')]), ['read:a'])).toEqual({ needed: 1, got: 1, done: true });
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

describe('the round on the answer side', () => {
  it('marks the round sentences in order, right sticking, skipped ones untried', () => {
    const marks = roundRowMarks(
      [{ id: 'read:a', result: 'wrong' }, { id: 'translate:b', result: 'close' }, { id: 'read:c' }, { id: 'translate:d', result: 'right' }],
      ['read:a'],
    );
    expect(marks.map((m) => [m.key, m.outcome, m.label])).toEqual([
      ['a', 'right', 'In the round · ✓ Right'],
      ['b', 'close', 'In the round · ≈ Nearly'],
      ['c', 'untried', 'In the round'],
      ['d', 'right', 'In the round · ✓ Right'],
    ]);
    expect(roundRowMarks([{ id: 'bogus' }, { id: 'read:clue:n1', result: 'wrong' }], [])[0]).toMatchObject({ key: 'clue:n1', outcome: 'wrong', label: 'In the round · ✗ Not quite' });
  });
  it('puts them at the top in the round order', () => {
    const marks = roundRowMarks([{ id: 'read:c' }, { id: 'translate:a' }, { id: 'read:zzz' }], []);
    expect(orderKeysForRound(['a', 'b', 'c', 'd'], marks)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('brings the same exercises back from the log', () => {
    const list = [s('a'), s('b'), s('c')];
    expect(exercisesFromLog(list, ['translate:c', 'read:a', 'read:zzz'])?.map((e) => e.id)).toEqual(['read:a', 'translate:c']);
    expect(exercisesFromLog(list, ['read:a'], (k) => k === 'a')).toBeNull();
    expect(exercisesFromLog(list, [])).toBeNull();
  });
});

describe('roundEnglishShown', () => {
  it('hides a read exercise\'s English until it is judged — right, nearly or not quite — and EN toggles it', () => {
    expect(roundEnglishShown('read', null, false, null)).toBe(false);
    expect(roundEnglishShown('read', null, false, true)).toBe(true); // EN before answering
    expect(roundEnglishShown('read', 'right', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'right', true, false)).toBe(false); // EN hides it again
    expect(roundEnglishShown('read', 'close', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'wrong', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'wrong', true, false)).toBe(false);
    expect(roundEnglishShown('read', null, true, null)).toBe(false); // still being checked
  });
  it('a translate exercise\'s English is its question', () => {
    expect(roundEnglishShown('translate', null, false, null)).toBe(true);
  });
});
