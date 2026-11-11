/**
 * Which card introduces a brand-new word — the ONE card of an unseen note that the primary
 * (blue) pool shows first. The note's other cards arrive later through the secondary (purple)
 * pool, as before.
 *
 * Default: hanzi_to_meaning (see the characters, say the meaning).
 *
 * "Words made of characters I know: start with English → Chinese" (Settings → New cards;
 * new-card-order.ts `known_characters_english_first`, ON by default): a note whose Han
 * characters are ALL known starts with its meaning_to_hanzi card instead — he can already read
 * every character, so producing the word is the useful first step. Falls back to
 * hanzi_to_meaning when the note has no NEW meaning_to_hanzi card. A note with no Han
 * characters is unchanged.
 *
 * Known (progress/known.ts, mastery.ts): a card is known when it is mature — in Review with
 * stability > 21 days; a character is known when it appears in the hanzi of a note with a known
 * card. Read from the cards' current state (the queue's own inputs; both apps keep it derived
 * from the review events), never replayed here.
 *
 * "Start new words by ear" (new-card-order.ts `new_words_by_ear`, ON by default — Jerome reads
 * the words he knows but doesn't hear them): an unseen note leads with its audio_to_hanzi
 * (listening) card instead, ahead of the known-characters rule. A note with no NEW
 * audio_to_hanzi card (none, or held — suspended / snoozed cards never reach the queue) falls
 * back to the rules above. In the purple (secondary) pool the switch puts a started word's
 * listening card first — first of all for the words whose reading card is already in Review
 * (`secondaryTypeRank`); the pools' sizes never change.
 *
 * Only WHICH card of a note leads changes — never which notes come, or in what order (the
 * "Order new cards by" tiers rank notes; a note of known characters is by definition not in
 * the "new characters first" tier anyway). Bumps and homework passes are unchanged.
 *
 * Shared by the web (study-queue.ts → frontend/src/db/database.ts, useStudySession) and the
 * Lab app (android-lab/core LeadCard.kt, parity-tested through android-lab/parity).
 */
import { isHanCodePoint } from '../progress/known';

export const DEFAULT_LEAD_CARD_TYPE = 'hanzi_to_meaning';
export const KNOWN_CHARACTERS_LEAD_CARD_TYPE = 'meaning_to_hanzi';
/** "Start new words by ear": the listening card. */
export const EAR_LEAD_CARD_TYPE = 'audio_to_hanzi';

/** note id → the card type the (unseen) note leads with — only the notes that don't lead with hanzi_to_meaning. */
export type LeadCards = ReadonlyMap<string, string>;
/** The lead rule's input: the lead map, or (older callers) the set of notes that lead with meaning_to_hanzi. */
export type LeadCardsArg = LeadCards | ReadonlySet<string> | null | undefined;

/** A card is known (mature) above this stability, in days — the deck page's "mastered". */
export const KNOWN_STABILITY_DAYS = 21;

const QUEUE_REVIEW = 2;

/** Mature: in Review with stability > 21 days (progress/mastery.ts `masteryLevel` = 'mastered'). */
export function isKnownCardState(queue: number, stability: number | null | undefined): boolean {
  return queue === QUEUE_REVIEW && typeof stability === 'number' && stability > KNOWN_STABILITY_DAYS;
}

/** Notes with a known card. */
export function knownNoteIdsFrom(cards: Iterable<{ note_id: string; queue: number; stability?: number | null }>): Set<string> {
  const out = new Set<string>();
  for (const c of cards) if (isKnownCardState(c.queue, c.stability)) out.add(c.note_id);
  return out;
}

/** Every Han character of the known notes' hanzi. */
export function knownCharactersFrom(hanzi: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const h of hanzi) {
    for (const ch of h) if (isHanCodePoint(ch.codePointAt(0)!)) out.add(ch);
  }
  return out;
}

/** Every Han character of `hanzi` is in `known`; false when it has none. */
export function allCharactersKnown(hanzi: string, known: ReadonlySet<string>): boolean {
  let any = false;
  for (const ch of hanzi) {
    if (!isHanCodePoint(ch.codePointAt(0)!)) continue;
    if (!known.has(ch)) return false;
    any = true;
  }
  return any;
}

/**
 * The unseen notes that lead with meaning_to_hanzi: among `newCards` (NEW cards of notes with
 * no reviewed card — the primary pool's candidates), every note with a meaning_to_hanzi card
 * whose characters are all in `known`.
 */
export function knownCharacterNotes(
  newCards: Iterable<{ note_id: string; card_type: string }>,
  hanziOf: (noteId: string) => string,
  known: ReadonlySet<string>
): Set<string> {
  const out = new Set<string>();
  if (known.size === 0) return out;
  const checked = new Set<string>();
  for (const c of newCards) {
    if (c.card_type !== KNOWN_CHARACTERS_LEAD_CARD_TYPE || checked.has(c.note_id)) continue;
    checked.add(c.note_id);
    if (allCharactersKnown(hanziOf(c.note_id), known)) out.add(c.note_id);
  }
  return out;
}

/** The unseen notes among `newCards` (NEW cards of notes with no reviewed card) that have a NEW audio_to_hanzi card. */
export function earLeadNotes(newCards: Iterable<{ note_id: string; card_type: string }>): Set<string> {
  const out = new Set<string>();
  for (const c of newCards) if (c.card_type === EAR_LEAD_CARD_TYPE) out.add(c.note_id);
  return out;
}

/** The lead map: the ear notes lead with audio_to_hanzi (they win), the known-character notes with meaning_to_hanzi. */
export function leadCardsFrom(knownCharacterNoteIds: Iterable<string>, earNoteIds: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of knownCharacterNoteIds) out.set(id, KNOWN_CHARACTERS_LEAD_CARD_TYPE);
  for (const id of earNoteIds) out.set(id, EAR_LEAD_CARD_TYPE);
  return out;
}

/** The card type an unseen note leads with. */
export function leadCardType(noteId: string, leads: LeadCardsArg): string {
  if (!leads) return DEFAULT_LEAD_CARD_TYPE;
  if (leads instanceof Map) return leads.get(noteId) ?? DEFAULT_LEAD_CARD_TYPE;
  return (leads as ReadonlySet<string>).has(noteId) ? KNOWN_CHARACTERS_LEAD_CARD_TYPE : DEFAULT_LEAD_CARD_TYPE;
}

/** This card is its (unseen) note's lead card. */
export function isLeadCard(card: { note_id: string; card_type: string }, leads: LeadCardsArg): boolean {
  return card.card_type === leadCardType(card.note_id, leads);
}

/** Notes whose hanzi_to_meaning (reading) card is in Review (queue 2) — their listening card comes first in the purple pool. */
export function readingInReviewNoteIds(cards: Iterable<{ note_id: string; card_type: string; queue: number }>): Set<string> {
  const out = new Set<string>();
  for (const c of cards) if (c.card_type === DEFAULT_LEAD_CARD_TYPE && c.queue === QUEUE_REVIEW) out.add(c.note_id);
  return out;
}

/**
 * The purple (secondary) pool's order by card type, lower first: hanzi_to_meaning before the rest;
 * with "Start new words by ear" the listening card first — of the notes whose reading card is in
 * Review before the others — then hanzi_to_meaning, then the rest.
 */
export function secondaryTypeRank(card: { note_id: string; card_type: string }, byEar: boolean, readingInReview: ReadonlySet<string> | null | undefined): number {
  if (!byEar) return card.card_type === DEFAULT_LEAD_CARD_TYPE ? 0 : 1;
  if (card.card_type === EAR_LEAD_CARD_TYPE) return readingInReview?.has(card.note_id) ? 0 : 1;
  return card.card_type === DEFAULT_LEAD_CARD_TYPE ? 2 : 3;
}
