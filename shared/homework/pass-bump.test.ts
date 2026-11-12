import { describe, it, expect } from 'vitest';
import { passBumpHint, passBumpLabel, passBumpPlan, type PassBumpInput } from './pass-bump';
import { pocketSiblingIds, type QueueBumps } from '../decks/bumps';
import { countQueue, selectStudyQueue, type QueueCardInput, type QueueDeckInput } from '../decks/study-queue';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-12T10:00:00.000Z');
const CUTOFF = Date.parse('2026-11-12T22:59:59.999Z');
const BUMP = NOW - H;

const card = (id: string, note: string, queue: number, type = 'hanzi_to_meaning', due: number | null = null, deck = 'd1'): QueueCardInput => ({
  id, note_id: note, deck_id: deck, card_type: type, queue, due_ms: due,
});
const deck = (id: string, cap = 3, capS = 6): QueueDeckInput => ({ id, priority: 0, created_at: '2026-01-01', cap_primary: cap, cap_secondary: capS });
const threeNew = (note: string, deckId = 'd1') => [
  card(`${note}-h`, note, 0, 'hanzi_to_meaning', null, deckId),
  card(`${note}-m`, note, 0, 'meaning_to_hanzi', null, deckId),
  card(`${note}-a`, note, 0, 'audio_to_hanzi', null, deckId),
];
const input = (over: Partial<PassBumpInput>): PassBumpInput => ({
  cards: threeNew('n'), started: false, hasAudio: true, longTermPref: null, deckInReview: true, ...over,
});
const listeningBump = (note: string, created = BUMP): QueueBumps['bumps'][number] => ({ note_id: note, created_ms: created, card_types: ['audio_to_hanzi'] });

describe('passBumpPlan — what the homework pass’s ⚡ bumps', () => {
  it('an unstarted word with audio: ONLY its listening card', () => {
    expect(passBumpPlan(input({}))).toEqual({ kind: 'listening', cardTypes: ['audio_to_hanzi'], longTerm: undefined });
  });

  it('cards not on the device yet: still the listening card', () => {
    expect(passBumpPlan(input({ cards: [] })).cardTypes).toEqual(['audio_to_hanzi']);
  });

  it('no audio (or no NEW listening card): the lead card, one card', () => {
    expect(passBumpPlan(input({ hasAudio: false }))).toEqual({ kind: 'lead', cardTypes: ['hanzi_to_meaning'], longTerm: undefined });
    expect(passBumpPlan(input({ cards: threeNew('n').filter(c => c.card_type !== 'audio_to_hanzi') })).cardTypes).toEqual(['hanzi_to_meaning']);
    // A word of known characters with "English → Chinese" on leads with meaning_to_hanzi.
    expect(passBumpPlan(input({ hasAudio: false, knownCharactersLead: () => true })).cardTypes).toEqual(['meaning_to_hanzi']);
    // No NEW reading card: the next NEW card in card-type order.
    expect(passBumpPlan(input({ hasAudio: false, cards: [card('m', 'n', 0, 'meaning_to_hanzi'), card('a', 'n', 0, 'audio_to_hanzi')] })).cardTypes).toEqual(['meaning_to_hanzi']);
  });

  it('the known-characters check is only asked for when it matters', () => {
    let asked = 0;
    passBumpPlan(input({ knownCharactersLead: () => { asked++; return true; } }));
    expect(asked).toBe(0);
  });

  it('a started word: the whole-note bump, as before, and the long-term choice is left alone', () => {
    expect(passBumpPlan(input({ started: true, longTermPref: 0, deckInReview: false }))).toEqual({ kind: 'whole', cardTypes: null, longTerm: undefined });
  });

  it('opts the word into long-term review when it isn’t already (a one-off copy, or opted out)', () => {
    expect(passBumpPlan(input({ deckInReview: false })).longTerm).toBe(1);
    expect(passBumpPlan(input({ deckInReview: true, longTermPref: 0 })).longTerm).toBeNull();
    expect(passBumpPlan(input({ deckInReview: false, longTermPref: 1 })).longTerm).toBeUndefined();
    expect(passBumpPlan(input({ deckInReview: true })).longTerm).toBeUndefined();
  });

  it('labels say what a tap does, and the hint what happens to the rest', () => {
    expect(passBumpLabel('listening', false)).toBe('⚡ Study it today · listening card');
    expect(passBumpLabel('listening', true)).toBe('⚡ Listening card today ✓');
    expect(passBumpLabel('lead', true)).toBe('⚡ 1 card today ✓');
    expect(passBumpLabel('whole', false)).toBe('⚡ Study it today');
    expect(passBumpHint('listening')).toMatch(/other cards come later/);
    expect(passBumpHint('whole')).toBe('');
  });
});

describe('the queue after the pass’s ⚡ (listening card only)', () => {
  const budget = { new_cards_per_day: 3, secondary_cards_per_day: 6 };
  const queue = (cards: QueueCardInput[], b: QueueBumps | null, opts: { introduced?: Map<string, { primary: number; secondary: number }>; decks?: QueueDeckInput[]; longTerm?: Map<string, 0 | 1 | null>; upNext?: string[]; budget?: typeof budget } = {}) =>
    selectStudyQueue(opts.decks ?? [deck('d1')], cards, opts.budget ?? budget, 0, opts.introduced ?? new Map(), CUTOFF, null, null, opts.longTerm ?? null, b, opts.upNext ?? null);

  it('an unstarted word: today gains exactly ONE card, the listening card — its siblings wait', () => {
    const cards = threeNew('n');
    const before = queue(cards, null);
    expect(before.due.map(c => c.id)).toContain('n-h'); // without the bump: its cards from the blue budget
    const q = queue(cards, { bumps: [listeningBump('n')], lastReviewMs: new Map(), firstReviewMs: new Map() });
    expect(q.bumped.map(c => c.id)).toEqual(['n-a']);
    expect(q.due.map(c => c.id)).toEqual(['n-a']);
  });

  it('with other words in the deck, the budget goes to them, not to the bumped word’s siblings', () => {
    const cards = [...threeNew('n'), ...threeNew('x'), ...threeNew('y')];
    const q = queue(cards, { bumps: [listeningBump('n')], lastReviewMs: new Map(), firstReviewMs: new Map() });
    const ids = q.due.map(c => c.id);
    expect(ids[0]).toBe('n-a');
    expect(ids.filter(id => id.startsWith('n-'))).toEqual(['n-a']);
    expect(ids).toContain('x-h');
    expect(ids).toContain('y-h');
  });

  it('several words bumped: one card each', () => {
    const cards = [...threeNew('a'), ...threeNew('b'), ...threeNew('c'), ...threeNew('d')];
    const q = queue(cards, { bumps: ['a', 'b', 'c', 'd'].map(n => listeningBump(n)), lastReviewMs: new Map(), firstReviewMs: new Map() }, { budget: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
    expect(q.due.map(c => c.id)).toEqual(['a-a', 'b-a', 'c-a', 'd-a']);
  });

  it('once the listening card is reviewed, the siblings are purple (secondary) cards within the budget', () => {
    // The listening card was reviewed (now LEARNING, due tomorrow): the bump is done, the note is started.
    const cards = [card('n-h', 'n', 0, 'hanzi_to_meaning'), card('n-m', 'n', 0, 'meaning_to_hanzi'), card('n-a', 'n', 1, 'audio_to_hanzi', NOW + DAY)];
    const b: QueueBumps = { bumps: [listeningBump('n')], lastReviewMs: new Map([['n-a', NOW]]), firstReviewMs: new Map([['n-a', NOW]]) };
    const introduced = new Map([['d1', { primary: 1, secondary: 0 }]]);
    const q = queue(cards, b, { introduced });
    expect(q.bumped).toEqual([]);
    expect(q.due.map(c => c.id).sort()).toEqual(['n-h', 'n-m']);
    expect(countQueue(q.due, q.reviewedNoteIds)).toMatchObject({ new: 0, secondaryNew: 2 });
    // …only as far as the purple budget goes.
    const none = queue(cards, b, { introduced, budget: { new_cards_per_day: 1, secondary_cards_per_day: 0 } });
    expect(none.due).toEqual([]);
  });

  it('a one-off copy (caps 0 + 0): the siblings come later only because ⚡ opted the word in', () => {
    const cards = [card('n-h', 'n', 0, 'hanzi_to_meaning'), card('n-m', 'n', 0, 'meaning_to_hanzi'), card('n-a', 'n', 2, 'audio_to_hanzi', NOW + 3 * DAY)];
    const reviewed: QueueBumps = { bumps: [], lastReviewMs: new Map(), firstReviewMs: new Map() };
    const decks = [deck('d1', 0, 0)];
    expect(queue(cards, reviewed, { decks }).due).toEqual([]);
    expect(queue(cards, reviewed, { decks, longTerm: new Map([['n', 1]]) }).due.map(c => c.id).sort()).toEqual(['n-h', 'n-m']);
  });

  it('long-term opt-in alone puts nothing in today’s pocket', () => {
    const q = queue(threeNew('n'), null, { decks: [deck('d1', 0, 0)], longTerm: new Map([['n', 1]]), budget: { new_cards_per_day: 0, secondary_cards_per_day: 0 } });
    expect(q.bumped).toEqual([]);
    expect(q.due).toEqual([]); // only the daily budget can introduce it
  });

  it('Up next never brings a waiting sibling', () => {
    const q = queue(threeNew('n'), { bumps: [listeningBump('n')], lastReviewMs: new Map(), firstReviewMs: new Map() }, { upNext: ['n'] });
    expect(q.due.map(c => c.id)).toEqual(['n-a']);
    expect(q.upNext).toEqual([]);
  });

  it('pocketSiblingIds: only unstarted notes with a card in the pocket', () => {
    const cards = [...threeNew('n'), card('s-h', 's', 2, 'hanzi_to_meaning', NOW + 9 * DAY), card('s-m', 's', 0, 'meaning_to_hanzi')];
    const pocket = [cards[2], cards[4]];
    expect([...pocketSiblingIds(cards, pocket, new Set(['s']))].sort()).toEqual(['n-h', 'n-m']);
    expect(pocketSiblingIds(cards, [], new Set())).toEqual(new Set());
  });
});
