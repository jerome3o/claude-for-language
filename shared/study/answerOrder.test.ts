import { describe, expect, it } from 'vitest';
import { answerSentenceOrder, questionSentenceKeys } from './answerOrder';
import { orderKeysForRound, roundRowMarks } from './sentenceRound';

const KEYS = ['clue:n1', 's1', 's2', 's3', 's4', 's5'];

describe('answerSentenceOrder', () => {
  it('keeps the canonical order when the question side showed nothing', () => {
    expect(answerSentenceOrder(KEYS, [])).toEqual(KEYS);
    expect(answerSentenceOrder([], [])).toEqual([]);
  });

  it('puts the shown sentences first, in the order shown, then the rest as they were', () => {
    expect(answerSentenceOrder(KEYS, ['s4', 's1', 's3'])).toEqual(['s4', 's1', 's3', 'clue:n1', 's2', 's5']);
  });

  it('moves the card sentence to where it was shown (the badge goes with the row)', () => {
    expect(answerSentenceOrder(KEYS, ['s3', 'clue:n1', 's5'])).toEqual(['s3', 'clue:n1', 's5', 's1', 's2', 's4']);
  });

  it('leaves the card sentence first among the rest when it was not shown', () => {
    expect(answerSentenceOrder(KEYS, ['s5', 's2'])[2]).toBe('clue:n1');
  });

  it('counts a key shown twice once, at its first place', () => {
    expect(answerSentenceOrder(KEYS, ['s2', 's1', 's2', 's1'])).toEqual(['s2', 's1', 'clue:n1', 's3', 's4', 's5']);
  });

  it('skips a shown key that is no longer a row (hidden, regenerated set)', () => {
    expect(answerSentenceOrder(KEYS, ['gone', 's3', 'clue:other'])).toEqual(['s3', 'clue:n1', 's1', 's2', 's4', 's5']);
    expect(answerSentenceOrder(KEYS, ['gone'])).toEqual(KEYS);
  });

  it('never drops or adds a row', () => {
    const out = answerSentenceOrder(KEYS, ['s5', 's5', 'x', 'clue:n1']);
    expect([...out].sort()).toEqual([...KEYS].sort());
  });

  it('is what the Sentence round order already did', () => {
    const marks = roundRowMarks([{ id: 'read:s4' }, { id: 'translate:clue:n1', result: 'right' }], []);
    expect(orderKeysForRound(KEYS, marks)).toEqual(answerSentenceOrder(KEYS, ['s4', 'clue:n1']));
  });
});

describe('questionSentenceKeys', () => {
  it('lists Listen in context first, then the round', () => {
    expect(questionSentenceKeys(['s3', 's1'], ['s1', 's5'])).toEqual(['s3', 's1', 's1', 's5']);
    expect(answerSentenceOrder(KEYS, questionSentenceKeys(['s3', 's1'], ['s1', 's5']))).toEqual(['s3', 's1', 's5', 'clue:n1', 's2', 's4']);
    expect(questionSentenceKeys(null, undefined)).toEqual([]);
  });
});
