import { describe, it, expect } from 'vitest';
import { passCardId, passSuggestion, PASS_CARD_TYPE } from './index';
import { isAcceptedVerdict, type AnswerVerdict } from '../cards/answer';

describe('passCardId', () => {
  it('shows the read card (hanzi → meaning) of each word', () => {
    expect(PASS_CARD_TYPE).toBe('hanzi_to_meaning');
    expect(passCardId([
      { id: 'c-m', card_type: 'meaning_to_hanzi' },
      { id: 'c-a', card_type: 'audio_to_hanzi' },
      { id: 'c-h', card_type: 'hanzi_to_meaning' },
    ])).toBe('c-h');
  });

  it('falls back by type order, then id; none → null', () => {
    expect(passCardId([{ id: 'b', card_type: 'audio_to_hanzi' }, { id: 'a', card_type: 'meaning_to_hanzi' }])).toBe('a');
    expect(passCardId([{ id: 'b', card_type: 'audio_to_hanzi' }, { id: 'a', card_type: 'audio_to_hanzi' }])).toBe('a');
    expect(passCardId([{ id: 'x', card_type: 'something_else' }])).toBe('x');
    expect(passCardId([])).toBeNull();
  });
});

describe('passSuggestion', () => {
  it('a typing card: the verdict decides (homophones and a sentence said around it count)', () => {
    const verdicts: AnswerVerdict[] = ['exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains', 'close', 'wrong'];
    for (const v of verdicts) {
      expect(passSuggestion({ answerVerdict: v })).toBe(isAcceptedVerdict(v) ? 'right' : 'wrong');
    }
  });

  it('a read card: a matching take suggests Got it, a miss suggests nothing', () => {
    expect(passSuggestion({ take: { isMatch: true, containsExpected: false } })).toBe('right');
    expect(passSuggestion({ take: { isMatch: false, containsExpected: true } })).toBe('right');
    expect(passSuggestion({ take: { isMatch: false, containsExpected: false } })).toBeNull();
  });

  it('nothing tried: no suggestion', () => {
    expect(passSuggestion({})).toBeNull();
    expect(passSuggestion({ answerVerdict: null, take: null })).toBeNull();
  });
});
