/**
 * The homework pass's "⚡ Study it today" (docs/HOMEWORK.md §3c): what one tap puts in today's
 * study. Jerome (Nov 2026): "I've heard them in my lesson and done a one-off review once — just
 * add 1 card, the listening card, and let the other 2 come the way I normally get purple cards.
 * That way I can be liberal with adding these words."
 *
 *   - an UNSTARTED word (no card reviewed) → a CARD-LEVEL bump (shared/decks/bumps.ts
 *     `card_types`) of ONE card: its listening card (audio_to_hanzi) when the note has audio and
 *     a NEW listening card; else its lead card without the listening option (lead-card.ts:
 *     meaning_to_hanzi for a word of characters he knows with "English → Chinese" on, else
 *     hanzi_to_meaning). Its other cards wait (bumps.ts `pocketSiblingIds`) and, once that card
 *     is reviewed, arrive through the purple (secondary) pool within the daily budget;
 *   - and the word goes into long-term review (`longTerm`) when it isn't already — so a one-off
 *     copy's word (caps 0 + 0) gets its other cards later too. Opting in alone adds nothing to
 *     today's pocket;
 *   - a STARTED word → the whole-note bump, as before (its due cards / one early review, and
 *     any NEW card left — those would be purple anyway).
 *
 * Pure; the web pass (frontend/src/pages/HomeworkPassPage.tsx) and the Lab app
 * (android-lab/core PassBump.kt, parity-tested) both call it.
 */
import { BUMP_CARD_TYPE_ORDER } from '../decks/bumps';
import { DEFAULT_LEAD_CARD_TYPE, EAR_LEAD_CARD_TYPE, KNOWN_CHARACTERS_LEAD_CARD_TYPE } from '../decks/lead-card';
import { isLongTerm, prefForToggle, type LongTermPref } from '../decks/long-term';

/** listening = the listening card · lead = one other card (no audio) · whole = the whole note (started word). */
export type PassBumpKind = 'listening' | 'lead' | 'whole';

export interface PassBumpPlan {
  kind: PassBumpKind;
  /** The card types to bump (card-level), or null = the whole note. */
  cardTypes: string[] | null;
  /** The long-term choice to store with the bump; undefined = leave it as it is. */
  longTerm: LongTermPref | undefined;
}

export interface PassBumpInput {
  /** The note's cards on the device (empty = not here yet: treated as three NEW cards). */
  cards: ReadonlyArray<{ card_type: string; queue: number }>;
  /** A card of the note has been reviewed. */
  started: boolean;
  /** The note has its word clip (a listening card can be played). */
  hasAudio: boolean;
  /** "English → Chinese" applies: the setting is on and every character is known (lead-card.ts). Asked only when needed. */
  knownCharactersLead?: () => boolean;
  /** The word's long-term choice and whether its deck is in daily review (long-term.ts). */
  longTermPref: LongTermPref | undefined;
  deckInReview: boolean;
}

const QUEUE_NEW = 0;

export function passBumpPlan(input: PassBumpInput): PassBumpPlan {
  if (input.started) return { kind: 'whole', cardTypes: null, longTerm: undefined };
  const newTypes = new Set(
    input.cards.length === 0 ? BUMP_CARD_TYPE_ORDER : input.cards.filter(c => c.queue === QUEUE_NEW).map(c => c.card_type)
  );
  const longTerm = isLongTerm(input.longTermPref ?? null, input.deckInReview, false)
    ? undefined
    : prefForToggle(true, input.deckInReview);
  if (input.hasAudio && newTypes.has(EAR_LEAD_CARD_TYPE)) return { kind: 'listening', cardTypes: [EAR_LEAD_CARD_TYPE], longTerm };
  let lead: string | undefined;
  if (newTypes.has(KNOWN_CHARACTERS_LEAD_CARD_TYPE) && input.knownCharactersLead?.()) lead = KNOWN_CHARACTERS_LEAD_CARD_TYPE;
  else if (newTypes.has(DEFAULT_LEAD_CARD_TYPE)) lead = DEFAULT_LEAD_CARD_TYPE;
  else lead = (BUMP_CARD_TYPE_ORDER as readonly string[]).find(t => newTypes.has(t));
  if (!lead) return { kind: 'whole', cardTypes: null, longTerm };
  return { kind: 'lead', cardTypes: [lead], longTerm };
}

/** The button: off = what a tap does, on = what it did. */
export function passBumpLabel(kind: PassBumpKind, on: boolean): string {
  if (kind === 'listening') return on ? '⚡ Listening card today ✓' : '⚡ Study it today · listening card';
  if (kind === 'lead') return on ? '⚡ 1 card today ✓' : '⚡ Study it today · 1 card';
  return on ? '⚡ Today ✓' : '⚡ Study it today';
}

/** The muted line under the button while it is on ('' = none). */
export function passBumpHint(kind: PassBumpKind): string {
  if (kind === 'whole') return '';
  return 'Its other cards come later, with your daily new cards.';
}

/** What an existing bump row holds (its card types): one listening card, one other card, or the whole note. */
export function passBumpKindOfRow(cardTypes: readonly string[] | null | undefined): PassBumpKind {
  if (!cardTypes || cardTypes.length === 0) return 'whole';
  return cardTypes.length === 1 && cardTypes[0] === EAR_LEAD_CARD_TYPE ? 'listening' : 'lead';
}
