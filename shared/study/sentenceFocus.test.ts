import { describe, it, expect } from 'vitest';
import { CONTRIVED_SENTENCE_FOCUSES, isContrivedSentence, naturalSentenceCount, naturalSentencesFirst } from './sentenceFocus';
import {
  roundSentences, pickRoundExercises, roundSentenceCount, pickListenRoundExercises, listenRoundSentenceCount, exercisesFromLog,
  type RoundSentence,
} from './sentenceRound';
import { moreSentencesWanted } from './sentenceHistory';
import { listenContextRows, listenNaturalCount, needsSentenceTopUp } from './listenContext';

// Jerome, Nov 2026: "a few example sentences … are used to build a sentence with some related or similar sounding
// word … they make kind of contrived sentences."
const s = (key: string, focus: string | null = 'core', translation: string | null = `${key} en`): RoundSentence => ({
  key, hanzi: `银行${key}`, translation, focus,
});

describe('which sentences are contrived', () => {
  it('only the old forced focuses', () => {
    expect([...CONTRIVED_SENTENCE_FOCUSES]).toEqual(['shared_character', 'contrast']);
    expect(['shared_character', 'contrast'].map(isContrivedSentence)).toEqual([true, true]);
    expect(['core', 'collocation', 'complex', 'from_card', '', null, undefined, 'Contrast'].map(isContrivedSentence)).toEqual(
      [false, false, false, false, false, false, false, false],
    );
  });

  it('natural first, each group kept in order; counted apart', () => {
    const rows = [s('a'), s('b', 'contrast'), s('c', null), s('d', 'shared_character'), s('e', 'complex')];
    expect(naturalSentencesFirst(rows).map((r) => r.key)).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(naturalSentenceCount(rows)).toBe(3);
  });
});

describe('the Sentence round never uses a contrived sentence', () => {
  const set = [s('a'), s('b', 'shared_character'), s('c', 'collocation'), s('d', 'contrast'), s('e'), s('f', 'complex')];

  it('the list puts them last (like the card list)', () => {
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: '我去银行。', translation: 'x' }, set }).map((r) => r.key))
      .toEqual(['clue:n', 'a', 'c', 'e', 'f', 'b', 'd']);
  });

  it('no exercise and no count for them', () => {
    const list = roundSentences({ clue: null, set });
    const picked = pickRoundExercises(list);
    expect(picked.map((e) => e.key).sort()).toEqual(['a', 'c', 'e', 'f']);
    expect(roundSentenceCount(list)).toBe(4);
    // Only contrived sentences: no round at all.
    const onlyContrived = [s('x', 'contrast'), s('y', 'shared_character')];
    expect(pickRoundExercises(onlyContrived)).toEqual([]);
    expect(roundSentenceCount(onlyContrived)).toBe(0);
  });

  it('nor in the listening card round', () => {
    const list = roundSentences({ clue: null, set });
    expect(pickListenRoundExercises(list, '银行').map((e) => e.key)).toEqual(['a', 'c', 'e']);
    expect(listenRoundSentenceCount(list, '银行')).toBe(4);
    expect(listenRoundSentenceCount([s('x', 'contrast')], '银行')).toBe(0);
  });

  it('a round logged before is resumed without them', () => {
    const list = roundSentences({ clue: null, set });
    expect(exercisesFromLog(list, ['read:b', 'translate:c'])?.map((e) => e.id)).toEqual(['translate:c']);
    expect(exercisesFromLog(list, ['read:b', 'translate:d'])).toBeNull();
  });

  it('top-ups count natural sentences only', () => {
    // 5 rows, only 3 natural: fewer than the round's four → more, reason few.
    const rows = [s('a'), s('b', 'contrast'), s('c'), s('d', 'shared_character'), s('e')];
    expect(moreSentencesWanted(rows, new Map())?.reason).toBe('few');
    expect(moreSentencesWanted(rows.map((r) => ({ ...r, focus: 'core' })), new Map())?.reason).toBe('fresh');
  });
});

describe('Listen in context', () => {
  it('lists the contrived rows last, flagged, and never counts them', () => {
    const rows = listenContextRows('n', { hanzi: '我去银行。' }, [
      { id: 'a', hanzi: '银行a', position: 0, focus: 'contrast' },
      { id: 'b', hanzi: '银行b', position: 1, focus: 'core' },
      { id: 'c', hanzi: '银行c', position: 2, focus: 'shared_character' },
      { id: 'd', hanzi: '银行d', position: 3 },
    ]);
    expect(rows.map((r) => [r.key, r.contrived])).toEqual([['clue:n', false], ['b', false], ['d', false], ['a', true], ['c', true]]);
    expect(listenNaturalCount(rows)).toBe(3);
    expect(needsSentenceTopUp(listenNaturalCount(rows))).toBe(true);
  });
});
