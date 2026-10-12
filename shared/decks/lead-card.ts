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

/** The card type an unseen note leads with. */
export function leadCardType(noteId: string, knownCharacterNoteIds: ReadonlySet<string> | null | undefined): string {
  return knownCharacterNoteIds?.has(noteId) ? KNOWN_CHARACTERS_LEAD_CARD_TYPE : DEFAULT_LEAD_CARD_TYPE;
}

/** This card is its (unseen) note's lead card. */
export function isLeadCard(card: { note_id: string; card_type: string }, knownCharacterNoteIds: ReadonlySet<string> | null | undefined): boolean {
  return card.card_type === leadCardType(card.note_id, knownCharacterNoteIds);
}
