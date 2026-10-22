/**
 * "Practise this word other ways…" — the study card's ⋯ sheet (docs/STUDY_SESSION.md
 * "Other card types"). Jerome: "I've got the hanzi → spoken card and think 'I'd love to
 * remember this when I think of the English too' — let me send the other version of this
 * card into the current session." The sheet lists the note's card types with their state;
 * a NEW sibling can be added to today, a started one not due yet reviewed early — both
 * through a CARD-LEVEL bump (shared/decks/bumps.ts `card_types`): outside the daily budget,
 * a few cards later in this session, then FSRS from its first review (no fake events).
 *
 * Pure; the web sheet (components/study/OtherCardTypesSheet.tsx) and the Lab app
 * (core OtherCardTypes.kt, parity-tested by android-lab/parity/fixtures/other-card-types.ts)
 * both read it.
 */
import { BUMP_CARD_TYPE_ORDER } from './bumps';
import type { QueueCardInput } from './study-queue';

const DAY_MS = 86_400_000;

/** How the sheet names each card type. */
export const CARD_TYPE_SHORT_LABELS: Readonly<Record<string, string>> = {
  hanzi_to_meaning: 'Read → meaning',
  meaning_to_hanzi: 'English → 汉字',
  audio_to_hanzi: 'Listen → 汉字',
};

export function cardTypeShortLabel(cardType: string): string {
  return CARD_TYPE_SHORT_LABELS[cardType] ?? cardType;
}

/** 'add' = a NEW card → "⚡ Add to today"; 'early' = started, not due → "Review it early today". */
export type OtherCardAction = 'add' | 'early';

export interface OtherCardTypeRow {
  card_id: string;
  card_type: string;
  label: string;
  /** "this card" · "new" · "⚡ in today’s study" · "due today" · "in review, due in 12 days" · "learning, due tomorrow" */
  status: string;
  /** What the row can do; null = nothing (this card, already today, or the word is bumped whole). */
  action: OtherCardAction | null;
  is_current: boolean;
}

/** "due tomorrow" / "due in 12 days" for a card due after today's cutoff. */
export function dueInLabel(dueMs: number, cutoffMs: number): string {
  const days = Math.max(1, Math.ceil((dueMs - cutoffMs) / DAY_MS));
  return days === 1 ? 'due tomorrow' : `due in ${days} days`;
}

const typeRank = (t: string) => {
  const i = (BUMP_CARD_TYPE_ORDER as readonly string[]).indexOf(t);
  return i < 0 ? BUMP_CARD_TYPE_ORDER.length : i;
};

/**
 * The sheet's rows: every card of the note in card-type order, the one on screen marked
 * "this card". `inToday` = card ids already in today's study through the ⚡ pocket (this
 * session's bumped cards); `wholeNoteBumped` = the word has a whole-note bump (its new
 * cards are all in today already — nothing to add).
 */
export function otherCardTypeRows(
  noteCards: ReadonlyArray<QueueCardInput>,
  currentCardId: string,
  cutoffMs: number,
  inToday: ReadonlySet<string> = new Set(),
  wholeNoteBumped = false
): OtherCardTypeRow[] {
  const sorted = [...noteCards].sort(
    (a, b) => typeRank(a.card_type) - typeRank(b.card_type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return sorted.map(c => {
    const base = { card_id: c.id, card_type: c.card_type, label: cardTypeShortLabel(c.card_type), is_current: c.id === currentCardId };
    if (base.is_current) return { ...base, status: 'this card', action: null };
    if (inToday.has(c.id)) return { ...base, status: '⚡ in today’s study', action: null };
    if (c.queue === 0) return { ...base, status: 'new', action: wholeNoteBumped ? null : 'add' };
    const due = c.due_ms === null || c.due_ms <= cutoffMs;
    if (due) return { ...base, status: 'due today', action: null };
    const stage = c.queue === 2 ? 'in review' : 'learning';
    return { ...base, status: `${stage}, ${dueInLabel(c.due_ms as number, cutoffMs)}`, action: wholeNoteBumped ? null : 'early' };
  });
}

/** Card ids ticked when the sheet opens: the first NEW sibling (card-type order), else nothing. */
export function defaultOtherCardPicks(rows: ReadonlyArray<OtherCardTypeRow>): string[] {
  const first = rows.find(r => r.action === 'add');
  return first ? [first.card_id] : [];
}

/** True when the ⋯ menu offers "Practise this word other ways…": the note has another card. */
export function hasOtherCardTypes(noteCards: ReadonlyArray<{ id: string }>, currentCardId: string): boolean {
  return noteCards.some(c => c.id !== currentCardId);
}

/** The sheet's button: "⚡ Add 2 to today" ("Nothing to add" when nothing is ticked). */
export function otherCardsButtonLabel(count: number): string {
  return count > 0 ? `⚡ Add ${count} to today` : 'Nothing ticked';
}

/** The toast after adding: "⚡ English → 汉字 comes up in a few cards". */
export function otherCardsAddedMessage(labels: ReadonlyArray<string>): string {
  if (labels.length === 0) return 'Nothing added';
  const shown = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `⚡ ${shown} ${labels.length === 1 ? 'comes' : 'come'} up in a few cards`;
}

/** The analytics `types` prop: the chosen types joined with '/' (a safe enum token). */
export function otherCardTypesProp(cardTypes: ReadonlyArray<string>): string {
  return [...cardTypes].sort((a, b) => typeRank(a) - typeRank(b)).join('/');
}
