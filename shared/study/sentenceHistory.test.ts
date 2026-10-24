import { describe, it, expect } from 'vitest';
import {
  sentenceStats, knownInMode, compareLeastKnown, wantsMoreSentences, sentenceHistoryKey, showHiddenLabel,
  type SentencePracticeEvent,
} from './sentenceHistory';
import { pickRoundExercises, spreadOrder, type RoundSentence } from './sentenceRound';

let n = 0;
const ev = (e: Partial<SentencePracticeEvent> & Pick<SentencePracticeEvent, 'sentence_key' | 'kind'>): SentencePracticeEvent =>
  ({ id: `e${n++}`, note_id: 'n1', at: `2026-10-${String(10 + (n % 10)).padStart(2, '0')}T08:00:00.000Z`, ...e });
const attempt = (key: string, mode: 'read' | 'translate', result: 'right' | 'close' | 'wrong', at?: string) =>
  ev({ sentence_key: key, kind: 'attempt', mode, result, ...(at ? { at } : {}) });
const s = (key: string, translation: string | null = `${key} en`): RoundSentence => ({ key, hanzi: `${key}汉字`, translation });

describe('sentenceStats', () => {
  it('counts attempts / rights / misses per mode, dedupes ids, ignores other notes and junk', () => {
    const a = attempt('s1', 'read', 'right', '2026-10-01T00:00:00.000Z');
    const events = [a, a, attempt('s1', 'read', 'close', '2026-10-02T00:00:00.000Z'), attempt('s1', 'translate', 'wrong'),
      { ...attempt('s1', 'read', 'right'), note_id: 'other' }, { ...attempt('s1', 'read', 'right'), mode: 'x' as never }];
    const st = sentenceStats(events, 'n1').get('s1')!;
    expect(st.read).toEqual({ attempts: 2, rights: 1, misses: 1, last_at: '2026-10-02T00:00:00.000Z' });
    expect(st.translate.attempts).toBe(1);
    expect(st.translate.misses).toBe(1);
  });
  it('the last hide / unhide decides', () => {
    const events = [
      ev({ sentence_key: 'clue', kind: 'hide', reason: 'weird', at: '2026-10-01T00:00:00.000Z' }),
      ev({ sentence_key: 'clue', kind: 'unhide', at: '2026-10-02T00:00:00.000Z' }),
      ev({ sentence_key: 's2', kind: 'hide', reason: 'bogus' as never, at: '2026-10-03T00:00:00.000Z' }),
    ];
    const st = sentenceStats(events, 'n1');
    expect(st.get('clue')!.hidden).toBeNull();
    expect(st.get('s2')!.hidden).toEqual({ at: '2026-10-03T00:00:00.000Z', reason: null });
  });
  it('known after three rights in a mode', () => {
    const st = sentenceStats([1, 2, 3].map(() => attempt('s1', 'read', 'right')), 'n1').get('s1');
    expect(knownInMode(st, 'read')).toBe(true);
    expect(knownInMode(st, 'translate')).toBe(false);
  });
  it('clue rows map to the clue key', () => {
    expect(sentenceHistoryKey('clue:n1')).toBe('clue');
    expect(sentenceHistoryKey('abc')).toBe('abc');
    expect(showHiddenLabel(2)).toBe('Show hidden (2)');
  });
});

describe('least known first', () => {
  it('never practised, then fewer rights, more misses, longer ago', () => {
    const m = (attempts: number, rights: number, misses: number, last_at: string | null) => ({ attempts, rights, misses, last_at });
    expect(compareLeastKnown(undefined, m(1, 0, 1, 'x'))).toBeLessThan(0);
    expect(compareLeastKnown(m(2, 0, 2, 'b'), m(1, 1, 0, 'a'))).toBeLessThan(0);
    expect(compareLeastKnown(m(3, 1, 2, 'b'), m(2, 1, 1, 'a'))).toBeLessThan(0);
    expect(compareLeastKnown(m(1, 1, 0, 'a'), m(1, 1, 0, 'b'))).toBeLessThan(0);
    expect(compareLeastKnown(m(1, 1, 0, 'a'), m(1, 1, 0, 'a'))).toBe(0);
  });
  it('the round prefers what he knows least, shown easiest → harder; hidden sentences never come', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => s(k));
    expect(spreadOrder(6)).toEqual([0, 2, 3, 5, 1, 4]);
    expect(pickRoundExercises(list).map((e) => e.id)).toEqual(['read:a', 'translate:c', 'read:d', 'translate:f']);
    const history = sentenceStats([
      attempt('a', 'read', 'right'), attempt('d', 'read', 'right'), attempt('c', 'translate', 'right'),
      ev({ sentence_key: 'f', kind: 'hide', reason: 'wrong' }),
    ], 'n1');
    // Never-read b and e are read; c / f are out for translate (practised / hidden) → a and d (never translated).
    expect(pickRoundExercises(list, history).map((e) => e.id)).toEqual(['translate:a', 'read:b', 'translate:d', 'read:e']);
  });
});

describe('wantsMoreSentences', () => {
  const four = ['clue:n1', 'b', 'c', 'd'].map((k) => s(k));
  const knowAll = (keys: string[], modes: ('read' | 'translate')[]) =>
    keys.flatMap((k) => modes.flatMap((m) => [1, 2, 3].map(() => attempt(sentenceHistoryKey(k), m, 'right'))));
  it('fewer than four in rotation', () => {
    expect(wantsMoreSentences(four.slice(0, 3), new Map())).toBe(true);
    expect(wantsMoreSentences(four, sentenceStats([ev({ sentence_key: 'b', kind: 'hide', reason: 'too_rare' })], 'n1'))).toBe(true);
    expect(wantsMoreSentences(four, new Map())).toBe(false);
  });
  it('every one known in both modes (translate only where there is English)', () => {
    const list = [...four.slice(0, 3), s('d', null)];
    expect(wantsMoreSentences(list, sentenceStats(knowAll(['clue:n1', 'b', 'c'], ['read']), 'n1'))).toBe(false);
    expect(wantsMoreSentences(list, sentenceStats([...knowAll(['clue:n1', 'b', 'c'], ['read', 'translate']), ...knowAll(['d'], ['read'])], 'n1'))).toBe(true);
  });
});
