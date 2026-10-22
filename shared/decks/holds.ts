/**
 * Card holds — Anki's Suspend and Bury, with clearer words (docs/STUDY_SESSION.md
 * "Suspend & snooze"). Shared by the web app (frontend/src/db/database.ts →
 * selectStudyQueue / the Home counts) and the native Lab app (android-lab/core
 * CardHolds.kt, parity-tested through android-lab/parity/fixtures/card-holds.ts).
 * Pure: callers feed it rows and today's LOCAL date ("YYYY-MM-DD").
 *
 *   - SUSPEND: the card leaves all study (queue, new-card pools, ⚡ bumps, Up next,
 *     counts, Home) until it is unsuspended. Its review history and FSRS state are
 *     untouched; unsuspended, it comes back exactly as it was (an overdue review is
 *     simply due — FSRS schedules from the real elapsed time).
 *   - SNOOZE ("not today"): the same, until a local date — Until tomorrow · For a week ·
 *     For a month. The schedule is not changed; on that date the card is back.
 *   - "Don't show a word's other card types on the same day" (Anki's sibling burying,
 *     a per-account switch, OFF by default): once one card of a word was reviewed today,
 *     the word's NEW and REVIEW cards wait until tomorrow. Learning / relearning cards are
 *     never held back, and a word bumped to today ("⚡ Study it today") is exempt — that
 *     is an explicit request to see it now.
 * A held NEW card is simply not in the pools, so its budget slot goes to the next new
 * card today. Holds never write a review event and never touch a card's state.
 */

import type { QueueCardInput } from './study-queue';

export type HoldKind = 'suspend' | 'snooze';
export type SnoozeLength = 'tomorrow' | 'week' | 'month';
/** "This card only" or "All card types of this word". */
export type HoldScope = 'card' | 'word';

/** One hold on one card (a row of `card_holds`). */
export interface CardHold {
  /** Client id (idempotent upload). */
  id: string;
  card_id: string;
  kind: HoldKind;
  /** Snooze: the LOCAL date it ends — the card is back on that day ("YYYY-MM-DD"). Suspend: null. */
  until: string | null;
  created_at: string;
}

export const SNOOZE_OPTIONS: ReadonlyArray<{ length: SnoozeLength; label: string }> = [
  { length: 'tomorrow', label: 'Until tomorrow' },
  { length: 'week', label: 'For a week' },
  { length: 'month', label: 'For a month' },
];

export const HOLD_SCOPE_OPTIONS: ReadonlyArray<{ scope: HoldScope; label: string }> = [
  { scope: 'card', label: 'This card only' },
  { scope: 'word', label: 'All card types of this word' },
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A "YYYY-MM-DD" that is a real date. */
export function isLocalDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  return [+m[1], +m[2], +m[3]];
}

/** Days since 1970-01-01 of a calendar date (proleptic Gregorian; no time zones involved). */
export function dayNumber(date: string): number {
  const [y, m, d] = parts(date);
  // Howard Hinnant's days_from_civil.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The calendar date `dayNumber` days after 1970-01-01. */
export function dateOfDayNumber(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function addLocalDays(date: string, days: number): string {
  return dateOfDayNumber(dayNumber(date) + days);
}

/** Same day of the month `months` later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addLocalMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** The local date a snooze made `today` ends on (the card is back that day). */
export function snoozeUntil(today: string, length: SnoozeLength): string {
  if (length === 'week') return addLocalDays(today, 7);
  if (length === 'month') return addLocalMonths(today, 1);
  return addLocalDays(today, 1);
}

/** Does this hold keep its card out of study on `today`? */
export function isHoldActive(hold: Pick<CardHold, 'kind' | 'until'>, today: string): boolean {
  if (hold.kind === 'suspend') return true;
  return isLocalDate(hold.until) && today < hold.until;
}

/** The cards held out of study today (suspended, or snoozed past today). */
export function heldCardIds(holds: Iterable<Pick<CardHold, 'card_id' | 'kind' | 'until'>>, today: string): Set<string> {
  const out = new Set<string>();
  for (const h of holds) if (isHoldActive(h, today)) out.add(h.card_id);
  return out;
}

/**
 * The one hold that describes a card today: suspended wins over a snooze; of several
 * snoozes the one ending last. null = not held.
 */
export function activeHoldFor<H extends Pick<CardHold, 'kind' | 'until'>>(holds: Iterable<H>, today: string): H | null {
  let best: H | null = null;
  for (const h of holds) {
    if (!isHoldActive(h, today)) continue;
    if (h.kind === 'suspend') return h;
    if (!best || (h.until ?? '') > (best.until ?? '')) best = h;
  }
  return best;
}

/**
 * "Don't show a word's other card types on the same day": the NEW and REVIEW cards of a
 * word one of whose OTHER cards was reviewed today (`reviewedToday`, card ids). Learning /
 * relearning cards are never buried; `exemptNoteIds` (the ⚡ bumped notes) neither.
 */
export function siblingBuriedCardIds(
  cards: ReadonlyArray<Pick<QueueCardInput, 'id' | 'note_id' | 'queue'>>,
  reviewedToday: ReadonlySet<string>,
  exemptNoteIds?: Iterable<string> | null
): Set<string> {
  const out = new Set<string>();
  if (reviewedToday.size === 0) return out;
  const exempt = new Set(exemptNoteIds ?? []);
  // note id → the ids of its cards reviewed today
  const reviewedIn = new Map<string, string[]>();
  for (const c of cards) {
    if (!reviewedToday.has(c.id)) continue;
    const list = reviewedIn.get(c.note_id);
    if (list) list.push(c.id);
    else reviewedIn.set(c.note_id, [c.id]);
  }
  for (const c of cards) {
    if (c.queue !== 0 && c.queue !== 2) continue; // NEW and REVIEW only
    if (exempt.has(c.note_id)) continue;
    const reviewed = reviewedIn.get(c.note_id);
    if (reviewed && reviewed.some(id => id !== c.id)) out.add(c.id);
  }
  return out;
}

/** What the queue needs to know about holds (selectStudyQueue's `holds`). */
export interface QueueHolds {
  /** Cards suspended or snoozed today (`heldCardIds`). */
  held?: ReadonlySet<string> | null;
  /**
   * Set only when "Don't show a word's other card types on the same day" is on: the cards
   * reviewed today (any rating, first review at / after local midnight of their LATEST review).
   */
  reviewedToday?: ReadonlySet<string> | null;
}

/**
 * The cards that may be studied today: held ones out, then (switch on) the buried siblings.
 * `exemptNoteIds`: notes bumped to today, never buried.
 */
export function cardsInStudy<C extends Pick<QueueCardInput, 'id' | 'note_id' | 'queue'>>(
  cards: ReadonlyArray<C>,
  holds: QueueHolds | null | undefined,
  exemptNoteIds?: Iterable<string> | null
): ReadonlyArray<C> {
  if (!holds) return cards;
  const held = holds.held;
  let live: ReadonlyArray<C> = held && held.size > 0 ? cards.filter(c => !held.has(c.id)) : cards;
  if (holds.reviewedToday && holds.reviewedToday.size > 0) {
    const buried = siblingBuriedCardIds(live, holds.reviewedToday, exemptNoteIds);
    if (buried.size > 0) live = live.filter(c => !buried.has(c.id));
  }
  return live;
}

/** The cards a hold made from `card` covers: just it, or every card of its word. */
export function holdTargets<C extends { id: string; note_id: string }>(card: C, cardsOfNote: ReadonlyArray<C>, scope: HoldScope): C[] {
  if (scope === 'card') return [card];
  const out = cardsOfNote.filter(c => c.note_id === card.note_id);
  return out.some(c => c.id === card.id) ? out : [card, ...out];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov" (+ the year when it isn't `today`'s). */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = parts(date);
  const sameYear = isLocalDate(today) && parts(today)[0] === y;
  return `${d} ${MONTHS[m - 1]}${sameYear ? '' : ` ${y}`}`;
}

/** The status line of a held card: "Suspended" / "Snoozed until tomorrow" / "Snoozed until 3 Nov". */
export function holdStatusLabel(hold: Pick<CardHold, 'kind' | 'until'>, today: string): string {
  if (hold.kind === 'suspend') return 'Suspended';
  if (!isLocalDate(hold.until)) return 'Snoozed';
  if (hold.until <= addLocalDays(today, 1)) return 'Snoozed until tomorrow';
  return `Snoozed until ${shortDate(hold.until, today)}`;
}

/** The small tag on a deck page row / the card hub: icon + text, never colour alone. */
export function holdTag(hold: Pick<CardHold, 'kind' | 'until'>, today: string): { icon: string; text: string } {
  if (hold.kind === 'suspend') return { icon: '⏸️', text: 'Suspended' };
  if (isLocalDate(hold.until) && hold.until > addLocalDays(today, 1)) return { icon: '💤', text: `Snoozed · ${shortDate(hold.until, today)}` };
  return { icon: '💤', text: 'Snoozed · tomorrow' };
}

/**
 * A deck page row's tag for a word: "⏸️ Suspended" (every card), "⏸️ 1 of 3 suspended",
 * "💤 Snoozed · 29 Oct" (every card snoozed), "💤 2 of 3 snoozed"; null when nothing is held.
 * `holds` = the active hold per card id (any map from card id to a hold).
 */
export function noteHoldTag(
  cardIds: ReadonlyArray<string>,
  holds: ReadonlyMap<string, Pick<CardHold, 'kind' | 'until'>>,
  today: string
): { icon: string; text: string } | null {
  let suspended = 0;
  let latest: Pick<CardHold, 'kind' | 'until'> | null = null;
  let snoozed = 0;
  for (const id of cardIds) {
    const h = holds.get(id);
    if (!h || !isHoldActive(h, today)) continue;
    if (h.kind === 'suspend') suspended++;
    else {
      snoozed++;
      if (!latest || (h.until ?? '') > (latest.until ?? '')) latest = h;
    }
  }
  const total = cardIds.length;
  if (suspended === 0 && snoozed === 0) return null;
  if (suspended === total) return { icon: '⏸️', text: 'Suspended' };
  if (suspended > 0) return { icon: '⏸️', text: `${suspended} of ${total} suspended` };
  if (snoozed === total && latest) return holdTag(latest, today);
  return { icon: '💤', text: `${snoozed} of ${total} snoozed` };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The toast after a hold: "Suspended — it stays out of study until you unsuspend it." */
export function holdMessage(kind: HoldKind, count: number, length?: SnoozeLength | null): string {
  const what = count === 1 ? 'This card' : plural(count, 'card');
  if (kind === 'suspend') {
    return count === 1
      ? 'Suspended — it stays out of study until you unsuspend it.'
      : `${what} suspended — they stay out of study until you unsuspend them.`;
  }
  const when = length === 'week' ? 'for a week' : length === 'month' ? 'for a month' : 'until tomorrow';
  return count === 1 ? `Snoozed ${when}.` : `${what} snoozed ${when}.`;
}

/** The toast after Unsuspend / Wake now. */
export function releaseMessage(count: number): string {
  return count === 1 ? 'Back in study.' : `${plural(count, 'card')} back in study.`;
}

/** The ⋯ menu / sheet explanation for each kind. */
export const HOLD_EXPLANATION: Record<HoldKind, string> = {
  suspend:
    'Suspended cards leave study completely — no reviews, no new-card slot — until you unsuspend them. Their history and schedule are kept exactly as they are.',
  snooze:
    'Not today: the card is hidden until the day you pick, then comes back as it was. Its schedule doesn\'t change; a new card frees its slot for another new card today.',
};

/** The management list's filter chips. */
export type HoldFilter = 'all' | 'suspended' | 'snoozed';

export interface HoldListRow {
  card_id: string;
  hold: Pick<CardHold, 'kind' | 'until' | 'created_at'>;
  hanzi: string;
  pinyin: string;
  english: string;
}

/** Search (hanzi, pinyin with or without tones, English) + the filter chip; suspended first, then by date. */
export function filterHoldRows<R extends HoldListRow>(rows: ReadonlyArray<R>, query: string, filter: HoldFilter): R[] {
  const q = foldToneMarks(query.trim().toLowerCase());
  const out = rows.filter(r => {
    if (filter === 'suspended' && r.hold.kind !== 'suspend') return false;
    if (filter === 'snoozed' && r.hold.kind !== 'snooze') return false;
    if (!q) return true;
    return (
      r.hanzi.includes(query.trim()) ||
      foldToneMarks(r.pinyin.toLowerCase()).replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
      r.english.toLowerCase().includes(q)
    );
  });
  return out.sort((a, b) => {
    if (a.hold.kind !== b.hold.kind) return a.hold.kind === 'suspend' ? -1 : 1;
    if (a.hold.kind === 'snooze' && a.hold.until !== b.hold.until) return (a.hold.until ?? '') < (b.hold.until ?? '') ? -1 : 1;
    if (a.hold.created_at !== b.hold.created_at) return a.hold.created_at > b.hold.created_at ? -1 : 1;
    return a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0;
  });
}

const TONE_MARKS: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a', ē: 'e', é: 'e', ě: 'e', è: 'e', ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o', ū: 'u', ú: 'u', ǔ: 'u', ù: 'u', ǖ: 'ü', ǘ: 'ü', ǚ: 'ü', ǜ: 'ü',
};

/** The card types as the hold sheets / lists name them. */
export const CARD_TYPE_LABELS: Record<string, string> = {
  hanzi_to_meaning: 'Hanzi → Meaning',
  meaning_to_hanzi: 'Meaning → Hanzi',
  audio_to_hanzi: 'Audio → Hanzi',
};

export function cardTypeLabel(type: string): string {
  return CARD_TYPE_LABELS[type] ?? type;
}

/** Pinyin without tone marks (ü kept). */
export function foldToneMarks(s: string): string {
  let out = '';
  for (const ch of s) out += TONE_MARKS[ch] ?? ch;
  return out;
}
