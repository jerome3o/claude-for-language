/**
 * The other card types of the word on the study card — the top row of the card's ⋯ menu
 * (docs/STUDY_SESSION.md "The word's other cards in ⋯"). Jerome, Nov 2026: "On the answer side
 * of cards, maybe in the dot menu, I'd like to quickly see the status of the other variants of
 * this card … one for each other card type, with a little symbol to show the card type. If I
 * click on it, it gives me another menu that lets me bump / study today … indication of whether
 * it's not started yet, in the queue, or how well you know it."
 *
 * One tile per OTHER card of the note: the card type's symbol (读 / 写 / 听 — the card hub's
 * names), a status line computed on the device from the card's replayed state (works offline),
 * a strength (the mastery tier: 0 new · 1 learning · 2 familiar · 3 known — the deck page's and
 * Progress's rule, Review with stability > 21 days = known) and what its small menu can do
 * (⚡ Study it today = a card-level bump, release a hold, forget a started card).
 *
 * Pure; web components/study/SiblingCards.tsx and the Lab app (core SiblingStatus.kt,
 * parity-tested by android-lab/parity/fixtures/sibling-status.ts) both read it.
 */
import { isLeech } from '../cards/leech';
import { BUMP_CARD_TYPE_ORDER } from './bumps';
import { holdStatusLabel, isHoldActive, type CardHold } from './holds';
import { cardTypeShortLabel, otherCardsAddedMessage } from './other-card-types';

const DAY_MS = 86_400_000;

/** A card type's symbol and short name — the card hub's 读 Read · 写 Write · 听 Listen. */
export const SIBLING_TYPE_META: Readonly<Record<string, { symbol: string; name: string }>> = {
  hanzi_to_meaning: { symbol: '读', name: 'Read' },
  meaning_to_hanzi: { symbol: '写', name: 'Write' },
  audio_to_hanzi: { symbol: '听', name: 'Listen' },
};

export function siblingTypeMeta(cardType: string): { symbol: string; name: string } {
  return SIBLING_TYPE_META[cardType] ?? { symbol: '•', name: cardType };
}

export type SiblingStatus =
  | 'not_started'
  | 'new_today'
  | 'learning'
  | 'due'
  | 'review'
  | 'known'
  | 'suspended'
  | 'snoozed'
  | 'leech';

/** The tile's colour role. Only `known` uses a result colour (right ✓); `leech` the "needs work" one; the rest neutral. */
export type SiblingTone = 'neutral' | 'known' | 'leech' | 'held';

/** What ⚡ Study it today does: 'add' = a NEW card into today; 'early' = a started card reviewed early today. */
export type SiblingBump = 'add' | 'early';

export interface SiblingCardInput {
  id: string;
  card_type: string;
  /** 0 NEW, 1 LEARNING, 2 REVIEW, 3 RELEARNING. */
  queue: number;
  /** When it is due (epoch ms); null = due now. Ignored for NEW cards. */
  due_ms: number | null;
  stability?: number | null;
  lapses?: number | null;
}

export interface SiblingContext {
  /** The end of the study day (shared/study/studyDay.ts studyCutoffMs; 4 am rollover by default). */
  cutoffMs: number;
  /** The study day's key ('YYYY-MM-DD') — what holds compare their end date with. */
  today: string;
  /** The ACTIVE-or-not hold per card id (any hold; inactive ones are ignored). */
  holds?: ReadonlyMap<string, Pick<CardHold, 'kind' | 'until'>>;
  /** Card ids in today's study already: the session's queue, the ⚡ pocket, Up next's picks. */
  inToday?: ReadonlySet<string>;
  /** False where the ⚡ belongs to something else (a homework pass has its own). Default true. */
  canBump?: boolean;
}

export interface SiblingTile {
  card_id: string;
  card_type: string;
  /** 读 / 写 / 听 */
  symbol: string;
  /** Read / Write / Listen */
  name: string;
  /** "Read → meaning" / "English → 汉字" / "Listen → 汉字" (the submenu's heading). */
  detail: string;
  status: SiblingStatus;
  /** "Not started" · "New · in today's queue" · "Learning · due today" · "Due today" · "Review · next in 12d" · "Known · next in 3mo" · "Suspended" · "Snoozed until 3 Nov" · "Leech · missed 9×" */
  line: string;
  /** 0 new · 1 learning · 2 familiar · 3 known (stability > 21 d in Review). */
  strength: 0 | 1 | 2 | 3;
  tone: SiblingTone;
  /** What ⚡ Study it today does; null = not offered now (see `bump_note`). */
  bump: SiblingBump | null;
  /** Why ⚡ can't be used now (shown on the disabled action), null when it can — or isn't offered at all. */
  bump_note: string | null;
  /** The held card's way back: Unsuspend / Wake now. */
  release: 'unsuspend' | 'wake' | null;
  /** A started card can be forgotten (back to New). */
  can_forget: boolean;
}

/** The mastery tier (shared/progress/mastery.ts masteryLevel) as 0..3. */
export function siblingStrength(queue: number, stability: number | null | undefined): 0 | 1 | 2 | 3 {
  if (queue === 0) return 0;
  if (queue === 1 || queue === 3) return 1;
  const s = typeof stability === 'number' && Number.isFinite(stability) ? stability : 0;
  if (s <= 7) return 1;
  if (s <= 21) return 2;
  return 3;
}

/** "1d" · "12d" · "3mo" · "2y": how far after the study day's end a card is due. */
export function nextInLabel(dueMs: number, cutoffMs: number): string {
  const days = Math.max(1, Math.ceil((dueMs - cutoffMs) / DAY_MS));
  if (days < 60) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

const typeRank = (t: string) => {
  const i = (BUMP_CARD_TYPE_ORDER as readonly string[]).indexOf(t);
  return i < 0 ? BUMP_CARD_TYPE_ORDER.length : i;
};

/** One tile. */
export function siblingTile(card: SiblingCardInput, ctx: SiblingContext): SiblingTile {
  const meta = siblingTypeMeta(card.card_type);
  const strength = siblingStrength(card.queue, card.stability);
  const inToday = !!ctx.inToday?.has(card.id);
  const started = card.queue !== 0;
  const dueToday = started && (card.due_ms === null || card.due_ms <= ctx.cutoffMs);
  const hold = ctx.holds?.get(card.id);
  const held = hold && isHoldActive(hold, ctx.today) ? hold : null;
  const canBump = ctx.canBump !== false;

  let status: SiblingStatus;
  let line: string;
  if (held) {
    status = held.kind === 'suspend' ? 'suspended' : 'snoozed';
    line = holdStatusLabel(held, ctx.today);
  } else if (started && isLeech(card.lapses)) {
    status = 'leech';
    line = `Leech · missed ${card.lapses}×`;
  } else if (!started) {
    status = inToday ? 'new_today' : 'not_started';
    line = inToday ? 'New · in today’s queue' : 'Not started';
  } else if (card.queue === 1 || card.queue === 3) {
    status = 'learning';
    line = dueToday || inToday ? 'Learning · due today' : `Learning · next in ${nextInLabel(card.due_ms as number, ctx.cutoffMs)}`;
  } else if (dueToday || inToday) {
    status = 'due';
    line = dueToday ? 'Due today' : '⚡ In today’s study';
  } else if (strength === 3) {
    status = 'known';
    line = `Known · next in ${nextInLabel(card.due_ms as number, ctx.cutoffMs)}`;
  } else {
    status = 'review';
    line = `Review · next in ${nextInLabel(card.due_ms as number, ctx.cutoffMs)}`;
  }

  let bump: SiblingBump | null = null;
  let bumpNote: string | null = null;
  if (!canBump) {
    bump = null;
  } else if (held) {
    bumpNote = held.kind === 'suspend' ? 'Suspended — unsuspend it first' : 'Snoozed — wake it first';
  } else if (inToday) {
    bumpNote = 'Already in today’s study';
  } else if (dueToday) {
    bumpNote = 'Already due today';
  } else {
    bump = started ? 'early' : 'add';
  }

  const tone: SiblingTone = held ? 'held' : status === 'leech' ? 'leech' : status === 'known' ? 'known' : 'neutral';
  return {
    card_id: card.id,
    card_type: card.card_type,
    symbol: meta.symbol,
    name: meta.name,
    detail: cardTypeShortLabel(card.card_type),
    status,
    line,
    strength,
    tone,
    bump,
    bump_note: bumpNote,
    release: held ? (held.kind === 'suspend' ? 'unsuspend' : 'wake') : null,
    can_forget: started,
  };
}

/** The ⋯ menu's top row: every OTHER card of the note, in card-type order (read · write · listen). */
export function siblingTiles(
  noteCards: ReadonlyArray<SiblingCardInput>,
  currentCardId: string,
  ctx: SiblingContext
): SiblingTile[] {
  return noteCards
    .filter(c => c.id !== currentCardId)
    .sort((a, b) => typeRank(a.card_type) - typeRank(b.card_type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(c => siblingTile(c, ctx));
}

/**
 * The card types the word does NOT have, other than the one on screen — a note with no audio has
 * no listening card: "No 听 Listen card (no audio)". Card-type order.
 */
export function missingSiblingTypes(noteCardTypes: ReadonlyArray<string>, currentCardType: string): string[] {
  const have = new Set([...noteCardTypes, currentCardType]);
  return (BUMP_CARD_TYPE_ORDER as readonly string[]).filter(t => !have.has(t));
}

/** The disabled tile's line for a missing card type. */
export function missingSiblingLine(cardType: string): string {
  return cardType === 'audio_to_hanzi' ? 'No listening card (no audio)' : 'No card of this type';
}

/** The submenu's ⚡ label. */
export function siblingBumpLabel(bump: SiblingBump | null): string {
  return bump === 'early' ? '⚡ Study it today (review early)' : '⚡ Study it today';
}

/** After ⚡: "⚡ English → 汉字 comes up in a few cards" (in a session) / "⚡ English → 汉字 added to today". */
export function siblingBumpedMessage(tile: Pick<SiblingTile, 'detail'>, inSession: boolean): string {
  return inSession ? otherCardsAddedMessage([tile.detail]) : `⚡ ${tile.detail} added to today`;
}

/** The tile's accessible name: never colour alone. */
export function siblingTileLabel(tile: Pick<SiblingTile, 'symbol' | 'name' | 'line' | 'strength'>): string {
  return `${tile.name} card (${tile.symbol}): ${tile.line}. Strength ${tile.strength} of 3.`;
}

/** The analytics actions of the submenu. */
export const SIBLING_ACTIONS = ['bump', 'snooze', 'suspend', 'unsuspend', 'wake', 'forget', 'details'] as const;
export type SiblingAction = (typeof SIBLING_ACTIONS)[number];
