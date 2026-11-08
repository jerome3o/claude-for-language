import { describe, it, expect } from 'vitest';
import {
  sentenceStats, knownInMode, compareLeastKnown, wantsMoreSentences, sentenceHistoryKey, showHiddenLabel,
  moreSentencesWanted, freshSentenceCount, freshTopUpCount, isFreshSentence,
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
    // Fresh sentences first (never practised in EITHER mode): b and e take the first read / translate
    // slots; then the least known in the slot's mode — c was never read, a never translated (f hidden).
    expect(pickRoundExercises(list, history).map((e) => e.id)).toEqual(['translate:a', 'read:b', 'read:c', 'translate:e']);
  });
  it('a sentence read once is not asked again as a translate while fresh ones wait', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => s(k));
    const history = sentenceStats([attempt('a', 'read', 'right'), attempt('b', 'read', 'wrong'), attempt('c', 'translate', 'right')], 'n1');
    const picked = pickRoundExercises(list, history).map((e) => e.key);
    expect(picked).toHaveLength(4);
    expect(picked.some((k) => ['a', 'b', 'c'].includes(k))).toBe(false);
  });
});

describe('wantsMoreSentences / moreSentencesWanted (the fresh buffer)', () => {
  const keys = (n: number) => ['clue:n1', ...Array.from({ length: n - 1 }, (_, i) => `r${i}`)];
  const list = (n: number) => keys(n).map((k) => s(k));
  it('fewer than four in rotation → few', () => {
    expect(wantsMoreSentences(list(3), new Map())).toBe(true);
    expect(moreSentencesWanted(list(3), new Map())).toEqual({ reason: 'few', fresh: 3, count: 5 });
    const hiddenOne = sentenceStats([ev({ sentence_key: 'r0', kind: 'hide', reason: 'too_rare' })], 'n1');
    expect(moreSentencesWanted(list(4), hiddenOne)?.reason).toBe('few');
  });
  it('fewer than six fresh left → fresh, enough to get back to a buffer of eight', () => {
    expect(moreSentencesWanted(list(6), new Map())).toBeNull();
    expect(wantsMoreSentences(list(6), new Map())).toBe(false);
    expect(moreSentencesWanted(list(5), new Map())).toEqual({ reason: 'fresh', fresh: 5, count: 3 });
    // Eight sentences, four practised (any mode, right or wrong) → four fresh → four more.
    const used = sentenceStats([
      attempt('clue', 'read', 'right'), attempt('r0', 'translate', 'wrong'), attempt('r1', 'read', 'close'), attempt('r2', 'translate', 'right'),
    ], 'n1');
    expect(freshSentenceCount(list(8), used)).toBe(4);
    expect(moreSentencesWanted(list(8), used)).toEqual({ reason: 'fresh', fresh: 4, count: 4 });
  });
  it('all practised → a full top-up (capped)', () => {
    const all = sentenceStats(keys(10).map((k) => attempt(sentenceHistoryKey(k), 'read', 'right')), 'n1');
    expect(moreSentencesWanted(list(10), all)).toEqual({ reason: 'fresh', fresh: 0, count: 8 });
  });
  it('freshTopUpCount stays between 3 and 8', () => {
    expect([0, 1, 5, 6, 7, 20].map(freshTopUpCount)).toEqual([8, 7, 3, 3, 3, 3]);
  });
  it('isFreshSentence: no take in either mode, not hidden', () => {
    expect(isFreshSentence(undefined)).toBe(true);
    const st = sentenceStats([attempt('a', 'translate', 'wrong'), ev({ sentence_key: 'b', kind: 'hide', reason: 'weird' })], 'n1');
    expect(isFreshSentence(st.get('a'))).toBe(false);
    expect(isFreshSentence(st.get('b'))).toBe(false);
  });
});
