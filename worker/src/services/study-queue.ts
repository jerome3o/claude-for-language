/**
 * The study queue ON THE SERVER — the shared definition (shared/decks/study-queue.ts
 * `selectStudyQueue` / `countQueue`) over the server's card rows, so every number the server shows
 * as "due today" is what the learner's Home shows: reviews / learning cards due by the end of the
 * STUDY day + the new cards the ONE daily budget allocates (deck queue, caps, long-term choices,
 * ⚡ bumps, Up next, suspended / snoozed cards, "don't show a word's other card types on the same
 * day", "Pause new cards on heavy days").
 *
 * Two numbers, named for what they are:
 *   - `reviews_due`  = learning + review cards due today (no new cards);
 *   - `due_today`    = reviews_due + today's new cards (what Home's Study button says).
 * Before (Nov 2026) the server counted every card with no next review or one due by now: every NEW card in every
 * deck was "due" (Jerome's account: 8,571 "due today" of 13,902 cards).
 *
 * The server's card state is recomputed from the review events on every upload, so the inputs
 * are the same the device has once it synced. Not on the server: the device's "Study 10 more"
 * bonus and "Order new cards by" (it changes WHICH new cards, never how many).
 *
 * Used by: GET /api/me/study-queue (MCP list_decks / get_due_cards / get_overall_stats / study),
 * /api/stats/overview, /api/stats/deck/:id, /api/cards/due, the tutor's student progress and the
 * Claude agents' stats / due-card tools.
 */
import {
  budgetForToday,
  countQueue,
  heldCardIds,
  reviewLoadState,
  reviewLoadToday,
  selectStudyQueue,
  toLongTermPref,
  DEFAULT_SECONDARY_CAP,
  DEFAULT_STUDY_BUDGET,
  type IntroducedToday,
  type LongTermPref,
  type QueueBumps,
  type QueueCardInput,
  type QueueCounts,
  type QueueDeckInput,
  type QueueHolds,
  type StudyBudget,
} from '@shared/decks';
import { introducedToday } from '@shared/decks/study-queue';
import { studyCutoffMs, type StudyDay } from '../../../shared/study/studyDay';
import { getStudyDayUser, userStudyDay } from './study-day';
import { parseBumpCardTypes } from './study-bumps';

/** Server / SQLite times are ISO or 'YYYY-MM-DD HH:MM:SS' (UTC). */
export function timeMs(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

/** A card row as the server stores it. */
export interface ServerCardRow {
  id: string;
  note_id: string;
  deck_id: string;
  card_type: string;
  queue: number | null;
  due_timestamp: number | null;
  next_review_at: string | null;
  stability: number | null;
}

/** The queue's view of a stored card (the web's `queueInput`: learning = due_timestamp, review = next_review_at). */
export function queueCardFromRow(r: ServerCardRow): QueueCardInput {
  const queue = typeof r.queue === 'number' ? r.queue : 0;
  let due: number | null = null;
  if (queue === 2) due = timeMs(r.next_review_at);
  else if (queue === 1 || queue === 3) due = r.due_timestamp ?? timeMs(r.next_review_at);
  return { id: r.id, note_id: r.note_id, deck_id: r.deck_id, card_type: r.card_type, queue, due_ms: due, stability: r.stability };
}

/** Everything the shared queue needs for one user, loaded once. */
export interface StudyQueueInputs {
  decks: QueueDeckInput[];
  cards: QueueCardInput[];
  /** The account's budget (before "Pause new cards on heavy days"). */
  budget: StudyBudget;
  /** "Pause new cards on heavy days" limit (null = off). */
  pauseOver: number | null;
  day: StudyDay;
  nowMs: number;
  /** Cards reviewed today (any rating). */
  reviewedToday: Set<string>;
  /** First review (after the card's last forget) of the cards reviewed today and their siblings. */
  firstReviewMs: Map<string, number>;
  longTerm: Map<string, LongTermPref>;
  bumps: QueueBumps | null;
  upNext: string[];
  /** Suspended / snoozed today. */
  held: Set<string>;
  burySiblings: boolean;
}

/** Four numbers + the two named totals. */
export interface DueSummary {
  /** learning + review cards due today — no new cards. */
  reviews_due: number;
  /** reviews_due + today's new cards, as the budget allocates them: what Home's Study button counts. */
  due_today: number;
  /** today's new cards: blue (new words) and purple (other cards of started words). */
  new_today: number;
  counts: { new: number; extra_new: number; learning: number; review: number };
}

export function dueSummary(c: QueueCounts): DueSummary {
  const reviews = c.learning + c.review;
  const fresh = c.new + c.secondaryNew;
  return {
    reviews_due: reviews,
    due_today: reviews + fresh,
    new_today: fresh,
    counts: { new: c.new, extra_new: c.secondaryNew, learning: c.learning, review: c.review },
  };
}

export interface ServerStudyQueue extends DueSummary {
  /** The queue a session (all decks, or `deckId`) would get, in session order. */
  due: QueueCardInput[];
  /** Today's budget is 0 + 0: "Pause new cards on heavy days" is over its limit. */
  new_cards_paused: boolean;
  cutoff_ms: number;
  day_key: string;
}

/** The shared queue over loaded inputs (pure). `deckId` = a one-deck session. */
export function computeStudyQueue(inputs: StudyQueueInputs, deckId?: string | null): ServerStudyQueue {
  const cutoff = studyCutoffMs(inputs.nowMs, inputs.day);
  const introduced: Map<string, IntroducedToday> = introducedToday(inputs.cards, inputs.firstReviewMs, inputs.day.startMs);
  const load = reviewLoadState(
    reviewLoadToday(inputs.cards.filter((c) => !inputs.held.has(c.id)), inputs.reviewedToday, inputs.firstReviewMs, inputs.day.startMs, cutoff),
    inputs.pauseOver,
  );
  const holds: QueueHolds | null = inputs.held.size === 0 && !inputs.burySiblings
    ? null
    : { held: inputs.held, reviewedToday: inputs.burySiblings ? inputs.reviewedToday : null };
  const result = selectStudyQueue(
    inputs.decks, inputs.cards, budgetForToday(inputs.budget, load), 0, introduced, cutoff, deckId ?? null,
    null, inputs.longTerm, inputs.bumps, inputs.upNext, holds,
  );
  return {
    ...dueSummary(countQueue(result.due, result.reviewedNoteIds)),
    due: result.due,
    new_cards_paused: load.paused,
    cutoff_ms: cutoff,
    day_key: inputs.day.key,
  };
}

/** `ids` in chunks small enough for one D1 `IN (…)`. */
function chunks<T>(ids: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Per card, the first / last review after its last live forget ("Forget this card" restarts a card). */
async function reviewSpans(db: D1Database, userId: string, cardIds: string[]): Promise<Map<string, { first: number; last: number }>> {
  const out = new Map<string, { first: number; last: number }>();
  for (const chunk of chunks([...new Set(cardIds)])) {
    const rows = await db
      .prepare(
        `SELECT re.card_id, MIN(re.reviewed_at) AS first_at, MAX(re.reviewed_at) AS last_at
         FROM review_events re
         WHERE re.user_id = ? AND re.card_id IN (${chunk.map(() => '?').join(',')})
           AND re.reviewed_at > COALESCE((SELECT MAX(f.forgotten_at) FROM card_forgets f WHERE f.card_id = re.card_id AND f.undone_at IS NULL), '')
         GROUP BY re.card_id`
      )
      .bind(userId, ...chunk)
      .all<{ card_id: string; first_at: string; last_at: string }>();
    for (const r of rows.results ?? []) {
      const first = timeMs(r.first_at);
      const last = timeMs(r.last_at);
      if (first !== null && last !== null) out.set(r.card_id, { first, last });
    }
  }
  return out;
}

/**
 * Load one user's queue inputs. `fallbackTzOffset`: the caller's getTimezoneOffset() minutes when
 * the user has no time zone (a tutor reading a student).
 */
export async function loadStudyQueueInputs(
  db: D1Database,
  userId: string,
  opts: { nowMs?: number; fallbackTzOffset?: number | null } = {},
): Promise<StudyQueueInputs> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUser = await getStudyDayUser(db, userId);
  const day = userStudyDay(dayUser, nowMs, opts.fallbackTzOffset);
  const dayStartIso = new Date(day.startMs).toISOString();

  const [deckRows, cardRows, account, todayRows, longTermRows, bumpRows, upNextRows, holdRows] = await Promise.all([
    db.prepare('SELECT id, study_priority, created_at, new_cards_per_day, secondary_cards_per_day FROM decks WHERE user_id = ?')
      .bind(userId).all<{ id: string; study_priority: number | null; created_at: string; new_cards_per_day: number | null; secondary_cards_per_day: number | null }>(),
    db.prepare(
      `SELECT c.id, c.note_id, n.deck_id, c.card_type, c.queue, c.due_timestamp, c.next_review_at, c.stability
       FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?`
    ).bind(userId).all<ServerCardRow>(),
    db.prepare('SELECT new_cards_per_day, secondary_cards_per_day, pause_new_when_reviews_over, bury_siblings FROM users WHERE id = ?').bind(userId)
      .first<{ new_cards_per_day: number | null; secondary_cards_per_day: number | null; pause_new_when_reviews_over: number | null; bury_siblings: number | null }>(),
    // Reviewed today: the (user_id, reviewed_at) index; SQLite times compared as instants below.
    db.prepare(`SELECT DISTINCT card_id, reviewed_at FROM review_events WHERE user_id = ? AND reviewed_at >= ?`)
      .bind(userId, dayStartIso.slice(0, 10)).all<{ card_id: string; reviewed_at: string }>(),
    db.prepare('SELECT n.id, n.long_term FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ? AND n.long_term IS NOT NULL')
      .bind(userId).all<{ id: string; long_term: number | null }>().catch(() => ({ results: [] as Array<{ id: string; long_term: number | null }> })),
    db.prepare('SELECT note_id, created_at, card_types FROM study_bumps WHERE user_id = ? AND done_at IS NULL AND cleared_at IS NULL ORDER BY created_at, note_id')
      .bind(userId).all<{ note_id: string; created_at: string; card_types: string | null }>().catch(() => ({ results: [] as Array<{ note_id: string; created_at: string; card_types: string | null }> })),
    db.prepare('SELECT note_id FROM up_next WHERE user_id = ? AND done_at IS NULL AND removed_at IS NULL ORDER BY position, created_at')
      .bind(userId).all<{ note_id: string }>().catch(() => ({ results: [] as Array<{ note_id: string }> })),
    db.prepare('SELECT card_id, kind, until FROM card_holds WHERE user_id = ? AND cleared_at IS NULL')
      .bind(userId).all<{ card_id: string; kind: 'suspend' | 'snooze'; until: string | null }>().catch(() => ({ results: [] as Array<{ card_id: string; kind: 'suspend' | 'snooze'; until: string | null }> })),
  ]);

  const cards = (cardRows.results ?? []).map(queueCardFromRow);
  const decks: QueueDeckInput[] = (deckRows.results ?? []).map((d) => ({
    id: d.id,
    priority: d.study_priority ?? 0,
    created_at: d.created_at,
    cap_primary: d.new_cards_per_day ?? 0,
    cap_secondary: d.secondary_cards_per_day ?? DEFAULT_SECONDARY_CAP,
  }));

  const reviewedToday = new Set<string>();
  for (const r of todayRows.results ?? []) {
    const ms = timeMs(r.reviewed_at);
    if (ms !== null && ms >= day.startMs) reviewedToday.add(r.card_id);
  }

  // First reviews of today's cards and their siblings (introduced today: primary vs secondary),
  // and the bumped notes' cards' review spans — one pass over their events.
  const notesToday = new Set<string>();
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const id of reviewedToday) {
    const c = byId.get(id);
    if (c) notesToday.add(c.note_id);
  }
  const bumpNotes = new Set((bumpRows.results ?? []).map((b) => b.note_id));
  const spanCards = cards.filter((c) => notesToday.has(c.note_id) || bumpNotes.has(c.note_id)).map((c) => c.id);
  const spans = spanCards.length ? await reviewSpans(db, userId, spanCards) : new Map<string, { first: number; last: number }>();

  const firstReviewMs = new Map<string, number>();
  const lastReviewMs = new Map<string, number>();
  for (const [id, s] of spans) {
    firstReviewMs.set(id, s.first);
    lastReviewMs.set(id, s.last);
  }
  // A card whose reviews today all came before a forget is a new card again, not "reviewed today".
  for (const id of [...reviewedToday]) {
    const s = spans.get(id);
    if (!s || s.last < day.startMs) reviewedToday.delete(id);
  }

  const longTerm = new Map<string, LongTermPref>();
  for (const r of longTermRows.results ?? []) {
    const v = toLongTermPref(r.long_term);
    if (v !== null) longTerm.set(r.id, v);
  }

  const bumps: QueueBumps | null = (bumpRows.results ?? []).length
    ? {
        bumps: (bumpRows.results ?? []).map((b) => ({ note_id: b.note_id, created_ms: timeMs(b.created_at) ?? 0, card_types: parseBumpCardTypes(b.card_types) })),
        lastReviewMs,
        firstReviewMs,
      }
    : null;

  return {
    decks,
    cards,
    // The account's ONE daily budget (NULL = the default) — db/queries getStudyBudget.
    budget: {
      new_cards_per_day: account?.new_cards_per_day ?? DEFAULT_STUDY_BUDGET.new_cards_per_day,
      secondary_cards_per_day: account?.secondary_cards_per_day ?? DEFAULT_STUDY_BUDGET.secondary_cards_per_day,
    },
    pauseOver: typeof account?.pause_new_when_reviews_over === 'number' ? account.pause_new_when_reviews_over : null,
    day,
    nowMs,
    reviewedToday,
    firstReviewMs,
    longTerm,
    bumps,
    upNext: (upNextRows.results ?? []).map((r) => r.note_id),
    held: heldCardIds(holdRows.results ?? [], day.key),
    burySiblings: account?.bury_siblings === 1,
  };
}

/** The user's queue today (all decks, or one deck's session). */
export async function serverStudyQueue(
  db: D1Database,
  userId: string,
  opts: { deckId?: string | null; nowMs?: number; fallbackTzOffset?: number | null } = {},
): Promise<ServerStudyQueue> {
  return computeStudyQueue(await loadStudyQueueInputs(db, userId, opts), opts.deckId);
}

/** Each deck's own session ("Study" on that deck), from one load. */
export function perDeckDue(inputs: StudyQueueInputs, deckIds?: Iterable<string>): Map<string, DueSummary> {
  const out = new Map<string, DueSummary>();
  for (const id of deckIds ?? inputs.decks.map((d) => d.id)) {
    const { due_today, reviews_due, new_today, counts } = computeStudyQueue(inputs, id);
    out.set(id, { due_today, reviews_due, new_today, counts });
  }
  return out;
}
