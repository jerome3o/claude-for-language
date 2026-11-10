/**
 * "Start new words by ear" (new-card-order.ts `new_words_by_ear`, lead-card.ts): an unseen word
 * starts with its listening card, ahead of the known-characters rule; the purple pool gives a
 * started word's listening card first — first for the words whose reading card is in Review.
 * Only card types change: never which notes, never how many.
 */
import { describe, it, expect } from 'vitest';
import {
  EAR_LEAD_CARD_TYPE,
  earLeadNotes,
  isLeadCard,
  leadCardType,
  leadCardsFrom,
  readingInReviewNoteIds,
  secondaryTypeRank,
} from './lead-card';
import { countQueue, earFirstWithinNotes, selectStudyQueue, type QueueCardInput, type QueueDeckInput } from './study-queue';
import { DEFAULT_NEW_CARD_ORDER, type NewCardOrder } from './new-card-order';

const decks: QueueDeckInput[] = [{ id: 'd', priority: 0, created_at: '2026-01-01T00:00:00Z', cap_primary: 20, cap_secondary: 10 }];
const later = Date.now() + 9e9;
const cutoff = Date.now() + 86_400_000;
// Ids sort hanzi_to_meaning (h) < meaning_to_hanzi (m) < audio_to_hanzi (z), so the id tie-break never favours the ear.
const suffix: Record<string, string> = { hanzi_to_meaning: 'h', meaning_to_hanzi: 'm', audio_to_hanzi: 'z' };
const card = (note: string, type: string, queue = 0, stability?: number): QueueCardInput =>
  ({ id: `${note}-${suffix[type]}`, note_id: note, deck_id: 'd', card_type: type, queue, due_ms: queue ? later : null, stability });
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const OFF: NewCardOrder = { ...DEFAULT_NEW_CARD_ORDER, new_words_by_ear: false };

describe('lead-card helpers', () => {
  it('ear notes win over known-character notes in the lead map', () => {
    const leads = leadCardsFrom(['a', 'b'], ['b', 'c']);
    expect(leadCardType('a', leads)).toBe('meaning_to_hanzi');
    expect(leadCardType('b', leads)).toBe(EAR_LEAD_CARD_TYPE);
    expect(leadCardType('c', leads)).toBe(EAR_LEAD_CARD_TYPE);
    expect(leadCardType('d', leads)).toBe('hanzi_to_meaning');
    // A Set still means "these lead with meaning_to_hanzi" (older callers).
    expect(leadCardType('a', new Set(['a']))).toBe('meaning_to_hanzi');
    expect(isLeadCard({ note_id: 'c', card_type: 'audio_to_hanzi' }, leads)).toBe(true);
    expect(isLeadCard({ note_id: 'c', card_type: 'hanzi_to_meaning' }, leads)).toBe(false);
  });

  it('only notes with a listening card can start by ear', () => {
    expect([...earLeadNotes([card('a', 'hanzi_to_meaning'), card('a', 'audio_to_hanzi'), card('b', 'meaning_to_hanzi')])]).toEqual(['a']);
  });

  it('purple order: listening first (reading in Review first), then hanzi_to_meaning, then the rest', () => {
    const inReview = new Set(['r']);
    const rank = (note: string, type: string, byEar: boolean) => secondaryTypeRank({ note_id: note, card_type: type }, byEar, inReview);
    expect(rank('r', 'audio_to_hanzi', true)).toBeLessThan(rank('x', 'audio_to_hanzi', true));
    expect(rank('x', 'audio_to_hanzi', true)).toBeLessThan(rank('x', 'hanzi_to_meaning', true));
    expect(rank('x', 'hanzi_to_meaning', true)).toBeLessThan(rank('x', 'meaning_to_hanzi', true));
    // Off: the old order (hanzi_to_meaning first, the rest equal).
    expect(rank('x', 'hanzi_to_meaning', false)).toBeLessThan(rank('r', 'audio_to_hanzi', false));
    expect(rank('r', 'audio_to_hanzi', false)).toBe(rank('x', 'meaning_to_hanzi', false));
    expect([...readingInReviewNoteIds([card('r', 'hanzi_to_meaning', 2), card('l', 'hanzi_to_meaning', 1), card('m', 'meaning_to_hanzi', 2)])]).toEqual(['r']);
  });

  it('Up next purple cards: listening first inside each note, the notes kept in list order', () => {
    const list = [card('b', 'hanzi_to_meaning'), card('b', 'audio_to_hanzi'), card('a', 'meaning_to_hanzi'), card('a', 'audio_to_hanzi')];
    expect(earFirstWithinNotes(list, new Set()).map(c => c.id)).toEqual(['b-z', 'b-h', 'a-z', 'a-m']);
  });
});

describe('the study queue: start new words by ear', () => {
  // Known: 大学 + 生活 (mature). w1 学生 = all known characters (the English-first rule would pick it).
  const hanzi = new Map(Object.entries({ k1: '大学', k2: '生活', w1: '学生', w2: '你好', w3: '谢谢', w4: '再见' }));
  const base = [
    card('k1', 'hanzi_to_meaning', 2, 40), card('k2', 'hanzi_to_meaning', 2, 30),
    ...TYPES.map(t => card('w1', t)),
    ...TYPES.map(t => card('w2', t)),
    card('w3', 'hanzi_to_meaning'), card('w3', 'meaning_to_hanzi'), // no listening card → the old rule
    ...TYPES.map(t => card('w4', t)),
  ];
  const run = (order: NewCardOrder = DEFAULT_NEW_CARD_ORDER, extra: { cards?: QueueCardInput[]; held?: string[]; upNext?: string[]; perDay?: number } = {}) =>
    selectStudyQueue(
      decks, extra.cards ?? base, { new_cards_per_day: extra.perDay ?? 4, secondary_cards_per_day: 0 }, 0, new Map(), cutoff, null,
      { hanzi, order }, null, null, extra.upNext ?? null, extra.held ? { held: new Set(extra.held) } : null,
    );
  const newIds = (q: ReturnType<typeof run>) => q.due.filter(c => c.queue === 0).map(c => c.id).sort();

  it('is on by default: every unseen word with a listening card starts with it — even a word of known characters', () => {
    const q = run();
    expect(q.newWordsByEar).toBe(true);
    expect(newIds(q)).toEqual(['w1-z', 'w2-z', 'w3-h', 'w4-z']);
    expect([...q.earLeadNoteIds].sort()).toEqual(['w1', 'w2', 'w4']);
    expect(q.knownCharacterNoteIds.size).toBe(0);
    expect(q.leadCards.get('w1')).toBe('audio_to_hanzi');
  });

  it('a note without a listening card falls back to the known-characters rule', () => {
    const cards = base.filter(c => c.id !== 'w1-z');
    const q = run(DEFAULT_NEW_CARD_ORDER, { cards });
    expect(newIds(q)).toEqual(['w1-m', 'w2-z', 'w3-h', 'w4-z']);
    expect([...q.knownCharacterNoteIds]).toEqual(['w1']);
  });

  it('a held (suspended / snoozed) listening card falls back too', () => {
    const q = run(DEFAULT_NEW_CARD_ORDER, { held: ['w2-z', 'w1-z'] });
    expect(newIds(q)).toEqual(['w1-m', 'w2-h', 'w3-h', 'w4-z']);
  });

  it('switched off: the old rules (known characters → English first, else hanzi first)', () => {
    const q = run(OFF);
    expect(q.newWordsByEar).toBe(false);
    expect(q.earLeadNoteIds.size).toBe(0);
    expect(newIds(q)).toEqual(['w1-m', 'w2-h', 'w3-h', 'w4-h']);
  });

  it('the same notes in the same counts either way — only the card type changes', () => {
    for (const perDay of [1, 2, 3, 5, 8]) {
      const on = run(DEFAULT_NEW_CARD_ORDER, { perDay });
      const off = run(OFF, { perDay });
      expect(countQueue(on.due, on.reviewedNoteIds)).toEqual(countQueue(off.due, off.reviewedNoteIds));
      const notes = (q: ReturnType<typeof run>) => q.due.filter(c => c.queue === 0).map(c => c.note_id).sort();
      expect(notes(on)).toEqual(notes(off));
    }
  });

  it('an Up next note takes its listening card as the blue card', () => {
    const q = run(DEFAULT_NEW_CARD_ORDER, { upNext: ['w3', 'w2'], perDay: 2 });
    expect(q.upNext.map(c => c.id)).toEqual(['w3-h', 'w2-z']);
  });

  it('without the notes\' text nothing changes (no account order known)', () => {
    const q = selectStudyQueue(decks, base, { new_cards_per_day: 4, secondary_cards_per_day: 0 }, 0, new Map(), cutoff);
    expect(q.newWordsByEar).toBe(false);
    expect(q.due.filter(c => c.queue === 0).every(c => c.card_type === 'hanzi_to_meaning')).toBe(true);
  });
});

describe('the study queue: purple cards listening first', () => {
  // s1: reading card still learning; s2: reading card in Review — its listening card comes first.
  const hanzi = new Map(Object.entries({ s1: '电脑', s2: '手机' }));
  const cards = [
    card('s1', 'hanzi_to_meaning', 1), card('s1', 'meaning_to_hanzi'), card('s1', 'audio_to_hanzi'),
    card('s2', 'hanzi_to_meaning', 2, 5), card('s2', 'meaning_to_hanzi'), card('s2', 'audio_to_hanzi'),
  ];
  const run = (order: NewCardOrder, secondary: number) => selectStudyQueue(
    decks, cards, { new_cards_per_day: 0, secondary_cards_per_day: secondary }, 0, new Map(), cutoff, null, { hanzi, order },
  );
  const purple = (q: ReturnType<typeof run>) => q.due.filter(c => c.queue === 0).map(c => c.id);

  it('on: the listening cards, the word read in Review first', () => {
    expect(purple(run(DEFAULT_NEW_CARD_ORDER, 1))).toEqual(['s2-z']);
    expect(purple(run(DEFAULT_NEW_CARD_ORDER, 2))).toEqual(['s2-z', 's1-z']);
    expect(purple(run(DEFAULT_NEW_CARD_ORDER, 4))).toEqual(['s2-z', 's1-z', 's1-m', 's2-m']);
  });

  it('off: the old order (by id among the non-reading cards); the pool size never changes', () => {
    expect(purple(run(OFF, 1))).toEqual(['s1-m']);
    for (const n of [0, 1, 2, 3, 4, 6]) expect(purple(run(OFF, n)).length).toBe(purple(run(DEFAULT_NEW_CARD_ORDER, n)).length);
  });
});
