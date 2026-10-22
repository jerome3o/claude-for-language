/**
 * Event-Sourced Card State Computation using FSRS Algorithm
 *
 * This module provides a pure, deterministic function to compute card state
 * from a sequence of review events using the FSRS (Free Spaced Repetition
 * Scheduler) algorithm.
 *
 * FSRS is a modern spaced repetition algorithm based on the DSR (Difficulty,
 * Stability, Retrievability) memory model. It requires 20-30% fewer reviews
 * than SM-2 to achieve the same retention level.
 *
 * Used by both frontend (offline study) and worker (server-side validation).
 */

import {
  fsrs,
  createEmptyCard,
  State,
  type Card as FSRSCard,
  type Grade,
  generatorParameters,
} from 'ts-fsrs';

// ============ Types ============

// Legacy rating type (0-3), maps to FSRS (1-4)
export type Rating = 0 | 1 | 2 | 3; // 0=again, 1=hard, 2=good, 3=easy

// Card queue/state - matches FSRS State enum
export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

export interface ReviewEvent {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: string; // ISO timestamp
  /**
   * 'forget' = "Forget this card" (docs/STUDY_SESSION.md "Forget"): the card starts again from
   * NEW at this moment and every earlier event stops counting for its schedule (the history is
   * kept). Its `rating` is ignored. Absent = an ordinary review. Forgets are stored apart from
   * reviews (`card_forgets`), so no review count / streak / stat ever sees one; they are merged
   * into a card's events only to replay its state (`withForgetEvents`).
   */
  kind?: 'forget';
}

/** One "Forget this card" as stored (D1 / IndexedDB / Room `card_forgets`). */
export interface CardForget {
  id: string;
  card_id: string;
  forgotten_at: string; // ISO timestamp
}

export function isForgetEvent(e: Pick<ReviewEvent, 'kind'>): boolean {
  return e.kind === 'forget';
}

/** A stored forget as the event the replay understands. */
export function forgetAsEvent(f: CardForget): ReviewEvent {
  return { id: f.id, card_id: f.card_id, rating: 0, reviewed_at: f.forgotten_at, kind: 'forget' };
}

/**
 * A card's review events with its forgets merged in, sorted by time. At the same instant a
 * forget comes AFTER the reviews (it was pressed on a card already reviewed then).
 */
export function withForgetEvents<E extends ReviewEvent>(events: readonly E[], forgets: readonly CardForget[]): Array<E | ReviewEvent> {
  if (forgets.length === 0) return [...events];
  const out: Array<E | ReviewEvent> = [...events, ...forgets.map(forgetAsEvent)];
  return out.sort((a, b) =>
    a.reviewed_at < b.reviewed_at ? -1 : a.reviewed_at > b.reviewed_at ? 1
      : (isForgetEvent(a) ? 1 : 0) - (isForgetEvent(b) ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** When the card was last forgotten (ISO), or null. */
export function lastForgetAt(forgets: readonly Pick<CardForget, 'forgotten_at'>[]): string | null {
  let last: string | null = null;
  for (const f of forgets) if (last === null || f.forgotten_at > last) last = f.forgotten_at;
  return last;
}

/**
 * The reviews that still count for the schedule: those strictly after the last forget (all of
 * them when the card was never forgotten). "Introduced today" and "first review" read these.
 */
export function reviewsSinceForget<E extends Pick<ReviewEvent, 'reviewed_at'>>(events: readonly E[], forgottenAt: string | null): E[] {
  return forgottenAt === null ? [...events] : events.filter(e => e.reviewed_at > forgottenAt);
}

/**
 * FSRS-based deck settings.
 * Note: learning_steps are no longer used - FSRS controls all scheduling.
 */
export interface DeckSettings {
  request_retention: number;    // Target retention (0.7 to 0.97), default 0.9
  maximum_interval: number;     // Maximum days between reviews, default 36500
  enable_fuzz: boolean;         // Add randomness to prevent clustering
  w: readonly number[];         // FSRS weights (21 parameters)
}

/**
 * Computed card state from FSRS.
 */
export interface ComputedCardState {
  queue: CardQueue;
  stability: number;            // Memory stability (days until R drops to 90%)
  difficulty: number;           // Card difficulty (1-10)
  scheduled_days: number;       // Days until next review
  reps: number;                 // Total successful reviews
  lapses: number;               // Times forgotten (Again count)
  next_review_at: string | null;  // ISO string for next review
  due_timestamp: number | null;   // Unix ms (for compatibility)
  last_reviewed_at: string | null; // ISO string of last review time (for FSRS elapsed_days)

  // Legacy fields for backward compatibility
  ease_factor: number;          // Mapped from stability (approximate)
  interval: number;             // Days (same as scheduled_days)
  repetitions: number;          // Same as reps
  learning_step: number;        // Always 0 (FSRS doesn't use fixed steps)
}

export interface CardCheckpoint {
  card_id: string;
  checkpoint_at: string;        // ISO timestamp of last event included
  event_count: number;          // Number of events processed
  state: ComputedCardState;
}

// Default FSRS parameters (customized)
const FSRS_DEFAULT_W = [
  0.212, 1.2931, 2.3065, 2.0,     // w0-w3: initial stability for each grade (w3 reduced from 8.3 to 2 days for Easy)
  6.4133, 0.8334, 3.0194, 0.001,  // w4-w7: difficulty parameters
  1.8722, 0.1666, 0.796, 1.4835,  // w8-w11: stability parameters
  0.0614, 0.2629, 1.6483, 0.6014, // w12-w15: more stability params
  1.8729, 0.5425, 0.0912, 0.0658, // w16-w19: short-term + decay
  0.1542                          // w20: forgetting curve decay
] as const;

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  request_retention: 0.9,       // 90% target retention
  maximum_interval: 36500,      // ~100 years max
  enable_fuzz: true,            // Prevent review clustering
  w: FSRS_DEFAULT_W,
};

// Create a shared FSRS instance with default parameters
const defaultFsrs = fsrs(generatorParameters({
  request_retention: DEFAULT_DECK_SETTINGS.request_retention,
  maximum_interval: DEFAULT_DECK_SETTINGS.maximum_interval,
  enable_fuzz: DEFAULT_DECK_SETTINGS.enable_fuzz,
  w: FSRS_DEFAULT_W,
  enable_short_term: true,      // Enable learning phase for new cards (Anki-like behavior)
}));

// ============ Rating Conversion ============

/**
 * Convert legacy rating (0-3) to FSRS Grade (1-4).
 * 0 (again) → Rating.Again (1)
 * 1 (hard)  → Rating.Hard (2)
 * 2 (good)  → Rating.Good (3)
 * 3 (easy)  → Rating.Easy (4)
 */
function toFSRSGrade(rating: Rating): Grade {
  return (rating + 1) as Grade;
}

/**
 * Convert FSRS State to CardQueue (they're the same values).
 */
function toCardQueue(state: State): CardQueue {
  return state as number as CardQueue;
}

// ============ Initial State ============

/**
 * Creates the initial state for a new card (never reviewed).
 */
export function initialCardState(_settings: DeckSettings = DEFAULT_DECK_SETTINGS): ComputedCardState {
  const emptyCard = createEmptyCard();
  return fsrsCardToComputedState(emptyCard);
}

/**
 * Convert FSRS Card to our ComputedCardState.
 * @param card The FSRS card
 * @param reviewedAt Optional: when this review happened (for tracking last_reviewed_at)
 */
function fsrsCardToComputedState(card: FSRSCard, reviewedAt?: string): ComputedCardState {
  const dueDate = card.due;
  const dueTimestamp = dueDate.getTime();

  // For NEW cards, due is "now", so next_review_at should be null
  const isNew = card.state === State.New;

  // last_review from FSRS card, or the reviewedAt we pass in
  const lastReviewedAt = reviewedAt
    ?? (card.last_review ? card.last_review.toISOString() : null);

  return {
    queue: toCardQueue(card.state),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    next_review_at: isNew ? null : dueDate.toISOString(),
    due_timestamp: isNew ? null : dueTimestamp,
    last_reviewed_at: lastReviewedAt,

    // Legacy compatibility fields
    ease_factor: stabilityToEaseFactor(card.stability),
    interval: card.scheduled_days,
    repetitions: card.reps,
    learning_step: 0, // FSRS doesn't use fixed steps
  };
}

/**
 * Convert stability to approximate ease factor for backward compatibility.
 * This is a rough mapping - stability and ease factor are different concepts.
 */
function stabilityToEaseFactor(stability: number): number {
  // Rough approximation: stability of ~30 days → ease 2.5
  // Higher stability → higher "ease"
  const ease = 1.3 + (stability / 30) * 1.2;
  return Math.max(1.3, Math.min(3.0, ease));
}

// ============ FSRS Instance Creation ============

/**
 * Create an FSRS instance with custom settings.
 */
function createFsrs(settings: DeckSettings) {
  return fsrs(generatorParameters({
    request_retention: settings.request_retention,
    maximum_interval: settings.maximum_interval,
    enable_fuzz: settings.enable_fuzz,
    w: [...settings.w],
    enable_short_term: true, // Enable learning phase for new cards
  }));
}

// ============ State Application ============

/**
 * Apply a single review to the current FSRS card.
 */
function applyReviewToFsrsCard(
  card: FSRSCard,
  rating: Rating,
  reviewedAt: string,
  f: ReturnType<typeof fsrs>
): FSRSCard {
  const grade = toFSRSGrade(rating);
  const now = new Date(reviewedAt);
  const result = f.next(card, now, grade);
  return result.card;
}

/**
 * Apply a single review to the current state.
 * This is deterministic - same inputs always produce same outputs.
 *
 * @param state Current card state
 * @param rating User's rating (0-3)
 * @param settings Deck settings
 * @param reviewedAt When the review occurred (ISO string)
 * @returns New card state after the review
 */
export function applyReview(
  state: ComputedCardState,
  rating: Rating,
  settings: DeckSettings,
  reviewedAt: string
): ComputedCardState {
  // Convert ComputedCardState back to FSRS Card
  const fsrsCard = computedStateToFsrsCard(state, reviewedAt);

  // Get or create FSRS instance
  const f = settings === DEFAULT_DECK_SETTINGS ? defaultFsrs : createFsrs(settings);

  // Apply the review
  const newCard = applyReviewToFsrsCard(fsrsCard, rating, reviewedAt, f);

  // Pass reviewedAt so we track when this review happened
  return fsrsCardToComputedState(newCard, reviewedAt);
}

// ---- Unusable stored state ----

/**
 * FSRS's own bounds on a REVIEWED card (ts-fsrs S_MIN / S_MAX and its difficulty clamp): every
 * state the scheduler produces lies inside them, so clamping never changes a valid state.
 */
const STABILITY_MIN = 0.001;
const STABILITY_MAX = 36500;
const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 10;
/** The middle of the difficulty scale, for a reviewed card whose difficulty is not a number at all. */
const FALLBACK_DIFFICULTY = 5;

/** `x` clamped to [min, max]; not a finite number (NaN, ±Infinity, null, undefined) → `fallback`. */
function usableNumber(x: unknown, min: number, max: number, fallback: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  return Math.min(Math.max(x, min), max);
}

/** A stored timestamp as a Date, or undefined when it is missing or unparseable. */
function usableDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function isCardQueue(q: unknown): q is CardQueue {
  return q === CardQueue.NEW || q === CardQueue.LEARNING || q === CardQueue.REVIEW || q === CardQueue.RELEARNING;
}

/**
 * Convert ComputedCardState back to FSRS Card for processing.
 *
 * Card state is derived from review events, so a stored state is normally valid — but a corrupt /
 * legacy row (a reviewed card with stability 0, NaN, Infinity or missing, a queue that is no FSRS
 * state, a garbage date) made ts-fsrs return NaN intervals ("NaNy" on the rating buttons) and
 * `applyReview` throw "Invalid time value", and made the Lab app's port throw while showing the
 * card (its study screen froze). Such a card is scheduled from the nearest usable values instead:
 * stability clamped to [0.001, 36500] (not a finite number → 0.001, i.e. "forgotten": short intervals, never a
 * far-off due date), difficulty to [1, 10] (not finite → 5), an unknown queue = NEW, an unparseable
 * date = missing. A NEW card's stability / difficulty are not used by FSRS and pass through.
 * Valid states are untouched. Lab: CardScheduler.toFsrsCard (parity/fixtures/fsrs-degenerate.ts).
 */
function computedStateToFsrsCard(state: ComputedCardState, currentTime: string): FSRSCard {
  const now = new Date(currentTime);
  const queue = isCardQueue(state.queue) ? state.queue : CardQueue.NEW;
  const isNew = queue === CardQueue.NEW;

  // For new cards, due is now
  const due = isNew ? now : usableDate(state.next_review_at) ?? now;

  // Use last_reviewed_at for proper elapsed_days calculation
  const lastReview = usableDate(state.last_reviewed_at);

  return {
    due,
    stability: isNew ? state.stability : usableNumber(state.stability, STABILITY_MIN, STABILITY_MAX, STABILITY_MIN),
    difficulty: isNew ? state.difficulty : usableNumber(state.difficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, FALLBACK_DIFFICULTY),
    elapsed_days: 0, // Will be computed by FSRS based on last_review
    scheduled_days: state.scheduled_days,
    learning_steps: 0, // Not used with enable_short_term=false
    reps: state.reps,
    lapses: state.lapses,
    state: queue as number as State,
    last_review: lastReview,
  };
}

// ============ Main Computation ============

/**
 * Compute the current card state from a sequence of review events.
 *
 * This is the MAIN function for event-sourced state computation.
 * It is DETERMINISTIC - the same events will always produce the same state.
 *
 * @param events Review events sorted by reviewed_at (ascending)
 * @param settings Deck settings
 * @param checkpoint Optional checkpoint to start from (for performance)
 * @returns Computed card state
 */
export function computeCardState(
  events: ReviewEvent[],
  settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  checkpoint?: CardCheckpoint
): ComputedCardState {
  // Start from checkpoint or initial NEW state
  let state = checkpoint?.state ?? initialCardState(settings);

  // Find the starting index - events after checkpoint
  let startIdx = 0;
  if (checkpoint) {
    startIdx = events.findIndex(e => e.reviewed_at > checkpoint.checkpoint_at);
    if (startIdx === -1) {
      // All events are before or at checkpoint, state is current
      return state;
    }
  }

  // Get or create FSRS instance
  const f = settings === DEFAULT_DECK_SETTINGS ? defaultFsrs : createFsrs(settings);

  // Convert initial state to FSRS card
  let fsrsCard = computedStateToFsrsCard(state, events[startIdx]?.reviewed_at ?? new Date().toISOString());

  // Track the last review time
  let lastReviewedAt: string | undefined;

  // Replay each event to compute final state
  let forgotten = false;
  for (let i = startIdx; i < events.length; i++) {
    const event = events[i];
    if (isForgetEvent(event)) {
      // "Forget this card": back to a NEW card; nothing before counts any more.
      fsrsCard = computedStateToFsrsCard(initialCardState(settings), event.reviewed_at);
      lastReviewedAt = undefined;
      forgotten = true;
      continue;
    }
    fsrsCard = applyReviewToFsrsCard(fsrsCard, event.rating, event.reviewed_at, f);
    lastReviewedAt = event.reviewed_at;
    forgotten = false;
  }

  if (forgotten) return initialCardState(settings);
  return fsrsCardToComputedState(fsrsCard, lastReviewedAt);
}

/** A card's queue and stability right after one of its reviews. */
export interface CardTimelinePoint {
  reviewed_at: string;
  queue: CardQueue;
  stability: number;
}

/**
 * The same replay as `computeCardState(events)` (no checkpoint), keeping the state after
 * EVERY event — what a progress history needs ("was this card mature on day X?"). The last
 * point always equals `computeCardState(events)`'s queue / stability. A forget event gives a NEW
 * point (stability 0) and the replay restarts from it. Events must be sorted
 * by reviewed_at ascending, as for computeCardState.
 */
export function computeCardTimeline(
  events: readonly ReviewEvent[],
  settings: DeckSettings = DEFAULT_DECK_SETTINGS
): CardTimelinePoint[] {
  if (events.length === 0) return [];
  const f = settings === DEFAULT_DECK_SETTINGS ? defaultFsrs : createFsrs(settings);
  let fsrsCard = computedStateToFsrsCard(initialCardState(settings), events[0].reviewed_at);
  const out: CardTimelinePoint[] = [];
  for (const event of events) {
    if (isForgetEvent(event)) {
      fsrsCard = computedStateToFsrsCard(initialCardState(settings), event.reviewed_at);
      out.push({ reviewed_at: event.reviewed_at, queue: CardQueue.NEW, stability: 0 });
      continue;
    }
    fsrsCard = applyReviewToFsrsCard(fsrsCard, event.rating, event.reviewed_at, f);
    out.push({ reviewed_at: event.reviewed_at, queue: toCardQueue(fsrsCard.state), stability: fsrsCard.stability });
  }
  return out;
}

/**
 * Create a checkpoint from the current state.
 * Checkpoints allow efficient incremental computation.
 */
export function createCheckpoint(
  cardId: string,
  state: ComputedCardState,
  lastEvent: ReviewEvent,
  eventCount: number
): CardCheckpoint {
  return {
    card_id: cardId,
    checkpoint_at: lastEvent.reviewed_at,
    event_count: eventCount,
    state: { ...state },
  };
}

/**
 * Check if a checkpoint is stale (has new events since checkpoint).
 */
export function isCheckpointStale(
  checkpoint: CardCheckpoint,
  latestEventAt: string | null
): boolean {
  if (!latestEventAt) return false; // No events, checkpoint is current
  return latestEventAt > checkpoint.checkpoint_at;
}

// ============ Interval Preview ============

/**
 * Get preview of next intervals for each rating.
 * Used to display on rating buttons.
 */
export interface IntervalPreview {
  rating: Rating;
  intervalText: string;
  intervalDays: number;
  nextState: CardQueue;
}

/**
 * Get interval previews for all ratings.
 */
export function getIntervalPreviews(
  state: ComputedCardState,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  now: Date = new Date()
): IntervalPreview[] {
  const f = settings === DEFAULT_DECK_SETTINGS ? defaultFsrs : createFsrs(settings);
  const fsrsCard = computedStateToFsrsCard(state, now.toISOString());

  const previews: IntervalPreview[] = [];

  for (const rating of [0, 1, 2, 3] as Rating[]) {
    const grade = toFSRSGrade(rating);
    const result = f.next(fsrsCard, now, grade);
    const nextCard = result.card;

    // Calculate interval in days
    const intervalMs = nextCard.due.getTime() - now.getTime();
    const intervalDays = intervalMs / (1000 * 60 * 60 * 24);

    previews.push({
      rating,
      intervalText: formatInterval(intervalDays * 24 * 60), // Convert to minutes for formatting
      intervalDays,
      nextState: toCardQueue(nextCard.state),
    });
  }

  return previews;
}

// ============ Retrievability ============

/**
 * Calculate current retrievability (probability of recall).
 * Returns a value between 0 and 1.
 */
export function getRetrievability(
  state: ComputedCardState,
  settings: DeckSettings = DEFAULT_DECK_SETTINGS,
  now: Date = new Date()
): number {
  if (state.queue === CardQueue.NEW) {
    return 1; // New cards haven't been seen yet
  }

  const f = settings === DEFAULT_DECK_SETTINGS ? defaultFsrs : createFsrs(settings);
  const fsrsCard = computedStateToFsrsCard(state, now.toISOString());
  // A reviewed card with no (usable) last review: ts-fsrs throws "Invalid date". Count it as just
  // reviewed (0 days elapsed → R = 1), like the Lab port.
  if (fsrsCard.state !== State.New && !fsrsCard.last_review) return 1;

  return f.get_retrievability(fsrsCard, now, false);
}

// ============ Utility Functions ============

/**
 * Format interval for display.
 * @param minutes - interval in minutes
 * @param useLessThan - if true, show "<10m" style for short intervals
 */
export function formatInterval(minutes: number, useLessThan: boolean = false): string {
  if (useLessThan && minutes < 10) {
    return '<10m';
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 1440) { // less than 1 day
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  const days = Math.round(minutes / 1440);
  if (days < 7) {
    return `${days}d`;
  }
  if (days < 30) {
    const weeks = days / 7;
    return weeks === Math.floor(weeks) ? `${weeks}w` : `${weeks.toFixed(1)}w`;
  }
  if (days < 365) {
    const months = days / 30;
    return months === Math.floor(months) ? `${months}mo` : `${months.toFixed(1)}mo`;
  }
  const years = days / 365;
  return years === Math.floor(years) ? `${years}y` : `${years.toFixed(1)}y`;
}

// ============ Legacy Compatibility ============

// These functions are kept for backward compatibility during migration.
// They map old deck settings format to new FSRS settings.

/**
 * @deprecated Use DeckSettings directly. This parses old learning steps format.
 */
export function parseLearningSteps(stepsStr: string): number[] {
  return stepsStr.split(' ').map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
}

/**
 * Convert old DB deck settings format to FSRS settings.
 * Old settings are ignored - we use FSRS defaults.
 */
export function deckSettingsFromDb(_deck: {
  learning_steps?: string;
  graduating_interval?: number;
  easy_interval?: number;
  relearning_steps?: string;
  starting_ease?: number;
  minimum_ease?: number;
  maximum_ease?: number;
  interval_modifier?: number;
  hard_multiplier?: number;
  easy_bonus?: number;
}): DeckSettings {
  // Return FSRS defaults - old SM-2 settings are not used
  return DEFAULT_DECK_SETTINGS;
}
