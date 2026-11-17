import { describe, expect, it } from 'vitest';
import {
  canonicalSentenceKey,
  cardSentenceId,
  cardSentenceOf,
  isCardSentenceKey,
  isCardSentenceRow,
  withCardSentence,
  type SentenceRowLike,
} from './cardSentence';

const row = (id: string, position: number, hanzi: string, extra: Partial<SentenceRowLike> = {}): SentenceRowLike => ({
  id, note_id: 'n1', position, hanzi, pinyin: null, translation: null, audio_url: null, focus: 'core', focus_note: null, explanation: null, ...extra,
});
const card = (hanzi: string, extra: Partial<SentenceRowLike> = {}) => row('n1-card', -1, hanzi, { is_card: 1, focus: null, ...extra });
const ids = (rows: SentenceRowLike[]) => rows.map((r) => r.id);

describe('card sentence ids and keys', () => {
  it('is `<note>-card`, and folds the legacy keys into it', () => {
    expect(cardSentenceId('n1')).toBe('n1-card');
    expect(canonicalSentenceKey('clue', 'n1')).toBe('n1-card');
    expect(canonicalSentenceKey('clue:n1', 'x')).toBe('n1-card');
    expect(canonicalSentenceKey('s1', 'n1')).toBe('s1');
    expect(isCardSentenceKey('n1-card')).toBe(true);
    expect(isCardSentenceKey('clue:n1')).toBe(true);
    expect(isCardSentenceKey('s1')).toBe(false);
    expect(isCardSentenceRow({ id: 's1', is_card: 1 })).toBe(true);
    expect(isCardSentenceRow({ id: 's1', is_card: 0 })).toBe(false);
  });
});

describe('withCardSentence', () => {
  const set = [row('s2', 1, '银行在哪儿？'), row('s1', 0, '这是银行。')];

  it('keeps the stored card row first and the set in its order', () => {
    expect(ids(withCardSentence(null, [...set, card('我去银行。')]))).toEqual(['n1-card', 's1', 's2']);
    expect(ids(withCardSentence({ id: 'n1', sentence_clue: '我去银行。' }, [...set, card('我去银行。')]))).toEqual(['n1-card', 's1', 's2']);
  });

  it('makes the card row from the note while the device has none (synced before the migration)', () => {
    const list = withCardSentence({ id: 'n1', sentence_clue: ' 我去银行。 ', sentence_clue_pinyin: 'Wǒ qù yínháng.', sentence_clue_audio_url: 'generated/c.mp3' }, set);
    expect(ids(list)).toEqual(['n1-card', 's1', 's2']);
    expect(list[0]).toMatchObject({ hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: null, audio_url: 'generated/c.mp3', is_card: 1, position: -1 });
  });

  it('the note wins over an older card row (edited on this device)', () => {
    const list = withCardSentence({ id: 'n1', sentence_clue: '银行开门了。' }, [card('我去银行。', { explanation: '{}' }), ...set]);
    expect(list[0]).toMatchObject({ id: 'n1-card', hanzi: '银行开门了。', explanation: null });
  });

  it('fills what only the note has for the same sentence, and keeps the row otherwise', () => {
    const stored = card('我去银行。', { explanation: '{}', translation: null });
    const list = withCardSentence({ id: 'n1', sentence_clue: '我去银行。', sentence_clue_translation: 'I go to the bank.' }, [stored]);
    expect(list[0]).toMatchObject({ translation: 'I go to the bank.', explanation: '{}' });
    expect(withCardSentence({ id: 'n1', sentence_clue: '我去银行。' }, [stored])[0]).toBe(stored);
  });

  it('drops a card row the note no longer has, and a set row repeating the card sentence', () => {
    expect(ids(withCardSentence({ id: 'n1', sentence_clue: null }, [card('我去银行。'), ...set]))).toEqual(['s1', 's2']);
    expect(ids(withCardSentence({ id: 'n1', sentence_clue: '这是银行。' }, set))).toEqual(['n1-card', 's2']);
    expect(cardSentenceOf({ id: 'n1', sentence_clue: '' }, set)).toBeNull();
    expect(cardSentenceOf({ id: 'n1' }, [card('我去银行。')])?.hanzi).toBe('我去银行。');
  });
});
