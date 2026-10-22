import { describe, it, expect } from 'vitest';
import {
  defaultOtherCardPicks, dueInLabel, hasOtherCardTypes, otherCardTypeRows, otherCardsAddedMessage,
  otherCardsButtonLabel, otherCardTypesProp,
} from './other-card-types';
import type { QueueCardInput } from './study-queue';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-10-04T10:00:00.000Z');
const CUTOFF = Date.parse('2026-10-04T22:59:59.999Z');
const card = (id: string, type: string, queue: number, due: number | null = null): QueueCardInput => ({
  id, note_id: 'n', deck_id: 'd', card_type: type, queue, due_ms: due,
});

describe('otherCardTypeRows', () => {
  it('Jerome’s case: on the read card, English → 汉字 new, Listen → 汉字 in review', () => {
    const rows = otherCardTypeRows([
      card('a', 'audio_to_hanzi', 2, CUTOFF + 11 * DAY + 5 * H),
      card('h', 'hanzi_to_meaning', 2, NOW - H),
      card('m', 'meaning_to_hanzi', 0),
    ], 'h', CUTOFF);
    expect(rows.map(r => [r.label, r.status, r.action])).toEqual([
      ['Read → meaning', 'this card', null],
      ['English → 汉字', 'new', 'add'],
      ['Listen → 汉字', 'in review, due in 12 days', 'early'],
    ]);
    expect(defaultOtherCardPicks(rows)).toEqual(['m']);
  });

  it('due today, learning, already in today and a whole-note bump', () => {
    const cards = [
      card('h', 'hanzi_to_meaning', 0),
      card('m', 'meaning_to_hanzi', 1, CUTOFF + 2 * H),
      card('a', 'audio_to_hanzi', 3, NOW + H),
    ];
    expect(otherCardTypeRows(cards, 'a', CUTOFF).map(r => [r.status, r.action])).toEqual([
      ['new', 'add'], ['learning, due tomorrow', 'early'], ['this card', null],
    ]);
    expect(otherCardTypeRows(cards, 'a', CUTOFF, new Set(['h'])).map(r => [r.status, r.action])).toEqual([
      ['⚡ in today’s study', null], ['learning, due tomorrow', 'early'], ['this card', null],
    ]);
    expect(otherCardTypeRows(cards, 'm', CUTOFF, new Set(), true).map(r => [r.status, r.action])).toEqual([
      ['new', null], ['this card', null], ['due today', null],
    ]);
    expect(defaultOtherCardPicks(otherCardTypeRows(cards, 'h', CUTOFF))).toEqual([]);
  });

  it('a started card with no due date counts as due today', () => {
    expect(otherCardTypeRows([card('h', 'hanzi_to_meaning', 0), card('m', 'meaning_to_hanzi', 2, null)], 'h', CUTOFF)[1].status).toBe('due today');
  });
});

describe('copy', () => {
  it('due labels', () => {
    expect(dueInLabel(CUTOFF + 1, CUTOFF)).toBe('due tomorrow');
    expect(dueInLabel(CUTOFF + DAY, CUTOFF)).toBe('due tomorrow');
    expect(dueInLabel(CUTOFF + DAY + 1, CUTOFF)).toBe('due in 2 days');
  });
  it('button, toast, analytics token, menu visibility', () => {
    expect(otherCardsButtonLabel(0)).toBe('Nothing ticked');
    expect(otherCardsButtonLabel(2)).toBe('⚡ Add 2 to today');
    expect(otherCardsAddedMessage(['English → 汉字'])).toBe('⚡ English → 汉字 comes up in a few cards');
    expect(otherCardsAddedMessage(['English → 汉字', 'Listen → 汉字'])).toBe('⚡ English → 汉字 and Listen → 汉字 come up in a few cards');
    expect(otherCardTypesProp(['audio_to_hanzi', 'meaning_to_hanzi'])).toBe('meaning_to_hanzi/audio_to_hanzi');
    expect(hasOtherCardTypes([{ id: 'h' }], 'h')).toBe(false);
    expect(hasOtherCardTypes([{ id: 'h' }, { id: 'm' }], 'h')).toBe(true);
  });
});
