import { describe, it, expect } from 'vitest';
import {
  allCharactersKnown,
  isKnownCardState,
  isLeadCard,
  knownCharacterNotes,
  knownCharactersFrom,
  knownNoteIdsFrom,
  leadCardType,
} from './lead-card';
import { countQueue, selectStudyQueue, type QueueCardInput, type QueueDeckInput, type QueueNoteText } from './study-queue';
import { DEFAULT_NEW_CARD_ORDER, type NewCardOrder } from './new-card-order';

describe('known cards and characters', () => {
  it('a card is known when mature: Review with stability > 21 days', () => {
    expect(isKnownCardState(2, 21.5)).toBe(true);
    expect(isKnownCardState(2, 21)).toBe(false);
    expect(isKnownCardState(2, 400)).toBe(true);
    expect(isKnownCardState(3, 100)).toBe(false); // relearning
    expect(isKnownCardState(1, 100)).toBe(false);
    expect(isKnownCardState(0, 100)).toBe(false);
    expect(isKnownCardState(2, undefined)).toBe(false);
    expect(isKnownCardState(2, null)).toBe(false);
    expect(isKnownCardState(2, Number.NaN)).toBe(false);
  });

  it('known notes = notes with any known card', () => {
    const ids = knownNoteIdsFrom([
      { note_id: 'a', queue: 2, stability: 30 },
      { note_id: 'a', queue: 0 },
      { note_id: 'b', queue: 2, stability: 5 },
      { note_id: 'c', queue: 1, stability: 50 },
    ]);
    expect([...ids]).toEqual(['a']);
  });

  it('known characters: every Han character of the known notes, punctuation and Latin dropped', () => {
    const known = knownCharactersFrom(['银行', '我在学校工作。', 'T恤', 'OK']);
    expect([...known].sort()).toEqual([...'银行我在学校工作恤'].sort());
  });

  it('all characters known: Han characters only, none = false', () => {
    const known = knownCharactersFrom(['大学', '生活', '你好']);
    expect(allCharactersKnown('学生', known)).toBe(true);
    expect(allCharactersKnown('大学生！', known)).toBe(true);
    expect(allCharactersKnown('你好吗？', known)).toBe(false); // 吗 unknown
    expect(allCharactersKnown('OK', known)).toBe(false);
    expect(allCharactersKnown('', known)).toBe(false);
    expect(allCharactersKnown('T好', known)).toBe(true);
  });
});

describe('the lead card of an unseen note', () => {
  const hanzi: Record<string, string> = { n1: '学生', n2: '学校', n3: 'OK', n4: '大学生活很好。', n5: '生活' };
  const hanziOf = (id: string) => hanzi[id] ?? '';
  const known = knownCharactersFrom(['大学', '生活', '很好']);

  it('meaning_to_hanzi when every character is known and the card exists', () => {
    const cards = [
      { note_id: 'n1', card_type: 'hanzi_to_meaning' },
      { note_id: 'n1', card_type: 'meaning_to_hanzi' },
      { note_id: 'n2', card_type: 'hanzi_to_meaning' }, // 校 unknown
      { note_id: 'n2', card_type: 'meaning_to_hanzi' },
      { note_id: 'n3', card_type: 'meaning_to_hanzi' }, // no Han characters
      { note_id: 'n4', card_type: 'meaning_to_hanzi' }, // a sentence of known characters
      { note_id: 'n5', card_type: 'hanzi_to_meaning' }, // no meaning_to_hanzi card → unchanged
      { note_id: 'n5', card_type: 'audio_to_hanzi' },
    ];
    const notes = knownCharacterNotes(cards, hanziOf, known);
    expect([...notes].sort()).toEqual(['n1', 'n4']);
    expect(leadCardType('n1', notes)).toBe('meaning_to_hanzi');
    expect(leadCardType('n2', notes)).toBe('hanzi_to_meaning');
    expect(leadCardType('n5', notes)).toBe('hanzi_to_meaning');
    expect(isLeadCard({ note_id: 'n1', card_type: 'meaning_to_hanzi' }, notes)).toBe(true);
    expect(isLeadCard({ note_id: 'n1', card_type: 'hanzi_to_meaning' }, notes)).toBe(false);
    expect(isLeadCard({ note_id: 'n2', card_type: 'hanzi_to_meaning' }, notes)).toBe(true);
    expect(isLeadCard({ note_id: 'n2', card_type: 'hanzi_to_meaning' }, null)).toBe(true);
  });

  it('nothing known → nothing changes', () => {
    expect(knownCharacterNotes([{ note_id: 'n1', card_type: 'meaning_to_hanzi' }], hanziOf, new Set()).size).toBe(0);
  });
});

describe('the study queue: a word of known characters starts with English → Chinese', () => {
  // Known: 大学 and 生活 (mature cards). Learning, not known: 学校 (stability 5).
  const decks: QueueDeckInput[] = [{ id: 'd', priority: 0, created_at: '2026-01-01T00:00:00Z', cap_primary: 20, cap_secondary: 10 }];
  const hanzi = new Map(Object.entries({
    k1: '大学', k2: '生活', l1: '学校',
    w1: '学生', w2: '学校生活', w3: '大学生活很好。', w4: 'OK', w5: '生大',
  }));
  const later = Date.now() + 9e9;
  const card = (note: string, type: string, queue = 0, stability?: number): QueueCardInput =>
    ({ id: `${note}-${type[0]}`, note_id: note, deck_id: 'd', card_type: type, queue, due_ms: queue ? later : null, stability });
  const types = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
  const base = [
    card('k1', 'hanzi_to_meaning', 2, 40), card('k2', 'hanzi_to_meaning', 2, 30), card('l1', 'hanzi_to_meaning', 2, 5),
    ...types.map(t => card('w1', t)), // 学生: 学 via 大学, 生 via 生活 → English first
    ...types.map(t => card('w2', t)), // 学校生活: 校 only in a learning note → unchanged
    ...types.map(t => card('w3', t)), // a sentence: 很 / 好 unknown here → unchanged
    ...types.map(t => card('w4', t)), // no Han characters → unchanged
    card('w5', 'hanzi_to_meaning'), card('w5', 'audio_to_hanzi'), // no meaning_to_hanzi card → unchanged
  ];
  const cutoff = Date.now() + 86_400_000;
  const run = (order: Partial<NewCardOrder> = {}, extra: Partial<QueueNoteText> = {}, perDay = 5) => selectStudyQueue(
    decks, base, { new_cards_per_day: perDay, secondary_cards_per_day: 0 }, 0, new Map(), cutoff, null,
    { hanzi, order: { ...DEFAULT_NEW_CARD_ORDER, ...order }, ...extra },
  );
  const newIds = (q: ReturnType<typeof run>) => q.due.filter(c => c.queue === 0).map(c => c.id).sort();

  it('picks meaning_to_hanzi for notes whose characters are all known, one card per note', () => {
    const q = run();
    expect([...q.knownCharacterNoteIds].sort()).toEqual(['w1']);
    expect(newIds(q)).toEqual(['w1-m', 'w2-h', 'w3-h', 'w4-h', 'w5-h'].sort());
  });

  it('a sentence whose characters are all known starts with English too', () => {
    const q = run({}, { knownNoteIds: ['k1', 'k2', 'w9'] }, 5);
    expect(q.knownCharacterNoteIds.has('w3')).toBe(false); // 很 / 好 unknown
    const known = new Map(hanzi);
    known.set('w9', '很好');
    const q2 = selectStudyQueue(decks, base, { new_cards_per_day: 5, secondary_cards_per_day: 0 }, 0, new Map(), cutoff, null,
      { hanzi: known, order: DEFAULT_NEW_CARD_ORDER, knownNoteIds: ['k1', 'k2', 'w9'] });
    expect([...q2.knownCharacterNoteIds].sort()).toEqual(['w1', 'w3']);
    expect(newIds(q2)).toContain('w3-m');
  });

  it('the same notes in the same counts as with the switch off — only the card type changes', () => {
    const on = run();
    const off = run({ known_characters_english_first: false });
    expect(off.knownCharacterNoteIds.size).toBe(0);
    expect(newIds(off)).toEqual(['w1-h', 'w2-h', 'w3-h', 'w4-h', 'w5-h'].sort());
    expect(countQueue(on.due, on.reviewedNoteIds)).toEqual(countQueue(off.due, off.reviewedNoteIds));
    const notes = (q: ReturnType<typeof run>) => q.due.filter(c => c.queue === 0).map(c => c.note_id);
    expect(notes(on)).toEqual(notes(off));
  });

  it('known notes passed in (a one-deck session) replace the ones read from the cards', () => {
    expect(run({}, { knownNoteIds: ['k1'] }).knownCharacterNoteIds.size).toBe(0); // only 大学: 学生 needs 生
    expect([...run({}, { knownNoteIds: ['k1', 'k2', 'l1'] }).knownCharacterNoteIds].sort()).toEqual(['w1', 'w2']);
  });

  it('without the notes\' text nothing changes', () => {
    const q = selectStudyQueue(decks, base, { new_cards_per_day: 5, secondary_cards_per_day: 0 }, 0, new Map(), cutoff);
    expect(q.knownCharacterNoteIds.size).toBe(0);
    expect(q.due.filter(c => c.queue === 0).every(c => c.card_type === 'hanzi_to_meaning')).toBe(true);
  });

  it('an Up next note of known characters takes its meaning_to_hanzi card as the blue card', () => {
    const q = selectStudyQueue(decks, base, { new_cards_per_day: 2, secondary_cards_per_day: 0 }, 0, new Map(), cutoff, null,
      { hanzi, order: DEFAULT_NEW_CARD_ORDER }, null, null, ['w1', 'w2']);
    expect(q.upNext.map(c => c.id)).toEqual(['w1-m', 'w2-h']);
    const off = selectStudyQueue(decks, base, { new_cards_per_day: 2, secondary_cards_per_day: 0 }, 0, new Map(), cutoff, null,
      { hanzi, order: { ...DEFAULT_NEW_CARD_ORDER, known_characters_english_first: false } }, null, null, ['w1', 'w2']);
    expect(off.upNext.map(c => c.id)).toEqual(['w1-h', 'w2-h']);
  });

  it('a budget larger than the unseen notes still gives each note its lead card first', () => {
    const fresh = run({}, {}, 7).due.filter(c => c.queue === 0);
    expect(fresh.slice(0, 5).map(c => c.id).sort()).toEqual(['w1-m', 'w2-h', 'w3-h', 'w4-h', 'w5-h'].sort());
    expect(fresh).toHaveLength(7);
  });
});
