/**
 * "⚡ Study it today" — what ONE tap puts in today's study, the same from everywhere (docs/STUDY_SESSION.md
 * "⚡ Study it today"). Jerome (Nov 2026): "the 'study today' behaviour should all be unified so it behaves
 * the same from anywhere, rn specifically it should just add the listening cards to the queue." First made
 * for the homework pass (docs/HOMEWORK.md §3c: "just add 1 card, the listening card, and let the other 2
 * come the way I normally get purple cards").
 *
 *   - an UNSTARTED word (no card reviewed) → a CARD-LEVEL bump (bumps.ts `card_types`) of ONE card: its
 *     listening card (audio_to_hanzi) when the note has audio and a NEW listening card; else its lead card
 *     without the listening option (lead-card.ts: meaning_to_hanzi for a word of characters he knows with
 *     "English → Chinese" on, else hanzi_to_meaning). Its other cards wait (bumps.ts `pocketSiblingIds`)
 *     and, once that card is reviewed, arrive through the purple (secondary) pool within the daily budget;
 *     and the word goes into long-term review (`longTerm`) when it isn't already — so a one-off copy's word
 *     (caps 0 + 0) gets its other cards later too. Opting in alone adds nothing to today's pocket;
 *   - a STARTED word → a card-level bump of its LISTENING card only (a due one moves to the front, a NEW one
 *     is introduced, one not due yet gets its one early review), when the note has audio and a listening
 *     card; else (no listening card / no audio) the whole-note bump (its due cards / one early review, and
 *     any NEW card left).
 *
 * Every ⚡ that doesn't let the learner pick card types goes through this rule: the language explorer, the
 * add-card sheets, word sheets, Make flashcards / Paste a list, the deck page, the card hub, Up next, the
 * homework pass (web services/studyBumps.ts `bumpNotes`, Lab BumpStore.bumpNotes) — and the server applies
 * it too to a bump that arrives without a plan (Claude's / the MCP's bump_cards, the tutor's student bumps,
 * older app builds; worker services/study-bumps.ts). "Practise this word other ways…" (other-card-types.ts)
 * is an explicit choice and stays as it is.
 *
 * Pure; shared by the web, the worker and the Lab app (android-lab/core StudyToday.kt, parity-tested).
 */
import { BUMP_CARD_TYPE_ORDER, bumpedMessage } from './bumps';
import { DEFAULT_LEAD_CARD_TYPE, EAR_LEAD_CARD_TYPE, KNOWN_CHARACTERS_LEAD_CARD_TYPE } from './lead-card';
import { isLongTerm, prefForToggle, type LongTermPref } from './long-term';

/** listening = the listening card · lead = one other card (no audio) · whole = the whole note. */
export type StudyTodayKind = 'listening' | 'lead' | 'whole';

export interface StudyTodayPlan {
  kind: StudyTodayKind;
  /** The card types to bump (card-level), or null = the whole note. */
  cardTypes: string[] | null;
  /** The long-term choice to store with the bump; undefined = leave it as it is. */
  longTerm: LongTermPref | undefined;
}

export interface StudyTodayInput {
  /** The note's cards (empty = not on the device yet: treated as three NEW cards). */
  cards: ReadonlyArray<{ card_type: string; queue: number }>;
  /** A card of the note has been reviewed (a card past NEW). */
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
const ALL_TYPES = BUMP_CARD_TYPE_ORDER as readonly string[];

export function studyTodayPlan(input: StudyTodayInput): StudyTodayPlan {
  const types = input.cards.length === 0 ? ALL_TYPES : input.cards.map(c => c.card_type);
  if (input.started) {
    if (input.hasAudio && types.includes(EAR_LEAD_CARD_TYPE)) return { kind: 'listening', cardTypes: [EAR_LEAD_CARD_TYPE], longTerm: undefined };
    return { kind: 'whole', cardTypes: null, longTerm: undefined };
  }
  const newTypes = new Set(input.cards.length === 0 ? ALL_TYPES : input.cards.filter(c => c.queue === QUEUE_NEW).map(c => c.card_type));
  const longTerm = isLongTerm(input.longTermPref ?? null, input.deckInReview, false)
    ? undefined
    : prefForToggle(true, input.deckInReview);
  if (input.hasAudio && newTypes.has(EAR_LEAD_CARD_TYPE)) return { kind: 'listening', cardTypes: [EAR_LEAD_CARD_TYPE], longTerm };
  let lead: string | undefined;
  if (newTypes.has(KNOWN_CHARACTERS_LEAD_CARD_TYPE) && input.knownCharactersLead?.()) lead = KNOWN_CHARACTERS_LEAD_CARD_TYPE;
  else if (newTypes.has(DEFAULT_LEAD_CARD_TYPE)) lead = DEFAULT_LEAD_CARD_TYPE;
  else lead = ALL_TYPES.find(t => newTypes.has(t));
  if (!lead) return { kind: 'whole', cardTypes: null, longTerm };
  return { kind: 'lead', cardTypes: [lead], longTerm };
}

/** The button: off = what a tap does, on = what it did. */
export function studyTodayLabel(kind: StudyTodayKind, on: boolean): string {
  if (kind === 'listening') return on ? '⚡ Listening card today ✓' : '⚡ Study it today · listening card';
  if (kind === 'lead') return on ? '⚡ 1 card today ✓' : '⚡ Study it today · 1 card';
  return on ? '⚡ Today ✓' : '⚡ Study it today';
}

/** The muted line under the button while it is on ('' = none). A started word's other cards keep their schedule. */
export function studyTodayHint(kind: StudyTodayKind, started = false): string {
  if (kind === 'whole' || started) return '';
  return 'Its other cards come later, with your daily new cards.';
}

/** What an existing bump row holds (its card types): one listening card, one other card, or the whole note. */
export function studyTodayKindOfRow(cardTypes: readonly string[] | null | undefined): StudyTodayKind {
  if (!cardTypes || cardTypes.length === 0) return 'whole';
  return cardTypes.length === 1 && cardTypes[0] === EAR_LEAD_CARD_TYPE ? 'listening' : 'lead';
}

const joinShown = (hanzi: string[]) => {
  const n = hanzi.length;
  return n === 1 ? hanzi[0] : n === 2 ? `${hanzi[0]} and ${hanzi[1]}` : `${hanzi[0]}, ${hanzi[1]} and ${n - 2} more`;
};

/**
 * The toast after a tap says what happened: "⚡ Listening card of 银行 added to today", "⚡ Listening cards of
 * 银行 and 学生 added to today", "⚡ 1 card of 银行 added to today"; whole-note bumps keep the old line
 * ("⚡ 银行 will come first in today’s study"); a mix: "⚡ 银行, 学生 and 2 more added to today".
 */
export function studyTodayMessage(added: ReadonlyArray<{ hanzi: string; kind: StudyTodayKind }>, alreadyBumped = 0): string {
  const shown = added.filter(a => a.hanzi);
  if (shown.length === 0) return bumpedMessage([], alreadyBumped);
  const hanzi = shown.map(a => a.hanzi);
  if (shown.every(a => a.kind === 'whole')) return bumpedMessage(hanzi, alreadyBumped);
  if (shown.every(a => a.kind === 'listening')) {
    return shown.length === 1 ? `⚡ Listening card of ${hanzi[0]} added to today` : `⚡ Listening cards of ${joinShown(hanzi)} added to today`;
  }
  if (shown.length === 1 && shown[0].kind === 'lead') return `⚡ 1 card of ${hanzi[0]} added to today`;
  return `⚡ ${joinShown(hanzi)} added to today`;
}
