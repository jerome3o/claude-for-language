/**
 * Review Event Service
 *
 * Manages local review events for the event-sourced sync architecture.
 * This service handles:
 * - Creating review events locally
 * - Computing card state from events
 * - Managing checkpoints for performance
 * - Syncing events to the server
 */

import { Rating } from '../types';
import {
  db,
  LocalReviewEvent,
  createLocalReviewEvent,
  getCardReviewEvents,
  getUnsyncedReviewEvents,
  markReviewEventsSynced,
  getCardCheckpoint,
  upsertCardCheckpoint,
  deleteCardCheckpoint,
  getEventSyncMeta,
  updateEventSyncMeta,
} from '../db/database';
import {
  computeCardState,
  applyReview,
  initialCardState,
  deckSettingsFromDb,
  DeckSettings,
  ComputedCardState,
  DEFAULT_DECK_SETTINGS,
} from '@shared/scheduler';
import { API_BASE } from '../api/client';

// Generate unique IDs for events
function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Record a review event locally and update card state.
 * This is the main entry point for recording reviews in the event-sourced architecture.
 */
export async function recordReviewEvent(
  cardId: string,
  rating: Rating,
  options: {
    timeSpentMs?: number;
    userAnswer?: string;
    recordingBlob?: Blob;
  } = {}
): Promise<{
  event: LocalReviewEvent;
  newState: ComputedCardState;
}> {
  const now = new Date().toISOString();
  const eventId = generateEventId();

  // Get current card and deck for settings
  const card = await db.cards.get(cardId);
  if (!card) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const deck = await db.decks.get(card.deck_id);
  const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;

  // Get existing events and checkpoint for this card
  const existingEvents = await getCardReviewEvents(cardId);
  const checkpoint = await getCardCheckpoint(cardId);

  // Compute current state from events + checkpoint
  const currentState = existingEvents.length > 0
    ? computeCardState(
        existingEvents.map(e => ({ id: e.id, card_id: e.card_id, rating: e.rating, reviewed_at: e.reviewed_at })),
        settings,
        checkpoint ? {
          card_id: checkpoint.card_id,
          checkpoint_at: checkpoint.checkpoint_at,
          event_count: checkpoint.event_count,
          state: {
            queue: checkpoint.queue,
            // FSRS fields
            stability: checkpoint.stability || checkpoint.interval || 0,
            difficulty: checkpoint.difficulty || 5,
            scheduled_days: checkpoint.interval,
            reps: checkpoint.repetitions,
            lapses: checkpoint.lapses || 0,
            last_reviewed_at: checkpoint.checkpoint_at, // Use checkpoint time as last review
            // Legacy fields
            learning_step: checkpoint.learning_step,
            ease_factor: checkpoint.ease_factor,
            interval: checkpoint.interval,
            repetitions: checkpoint.repetitions,
            next_review_at: checkpoint.next_review_at,
            due_timestamp: checkpoint.due_timestamp,
          },
        } : undefined
      )
    : initialCardState(settings);

  // Apply the new review to compute new state
  const newState = applyReview(currentState, rating, settings, now);

  // Create the event (without _created_at, it's added by createLocalReviewEvent)
  const eventData = {
    id: eventId,
    card_id: cardId,
    rating,
    time_spent_ms: options.timeSpentMs ?? null,
    user_answer: options.userAnswer ?? null,
    reviewed_at: now,
    _synced: 0,
  };

  // Store the event
  await createLocalReviewEvent(eventData);

  // Full event with _created_at for return value
  const event: LocalReviewEvent = {
    ...eventData,
    _created_at: now,
  };

  // Update the card with new state (for immediate UI feedback)
  await db.cards.update(cardId, {
    queue: newState.queue,
    // FSRS fields
    stability: newState.stability,
    difficulty: newState.difficulty,
    lapses: newState.lapses,
    // Legacy fields
    learning_step: newState.learning_step,
    ease_factor: newState.ease_factor,
    interval: newState.interval,
    repetitions: newState.repetitions,
    next_review_at: newState.next_review_at,
    due_timestamp: newState.due_timestamp,
    last_reviewed_at: now,
    updated_at: now,
  });

  // Update checkpoint if we have enough events (every 10 events)
  const totalEvents = existingEvents.length + 1;
  if (totalEvents % 10 === 0) {
    await upsertCardCheckpoint({
      card_id: cardId,
      checkpoint_at: now,
      event_count: totalEvents,
      queue: newState.queue,
      // FSRS fields
      stability: newState.stability,
      difficulty: newState.difficulty,
      lapses: newState.lapses,
      // Legacy fields
      learning_step: newState.learning_step,
      ease_factor: newState.ease_factor,
      interval: newState.interval,
      repetitions: newState.repetitions,
      next_review_at: newState.next_review_at,
      due_timestamp: newState.due_timestamp,
    });
  }

  // Store recording blob if provided (will be uploaded during sync)
  if (options.recordingBlob) {
    await db.pendingRecordings.put({
      id: eventId,
      blob: options.recordingBlob,
      uploaded: false,
      created_at: now,
    });
  }

  return { event, newState };
}

/**
 * Recompute card state from all events (for verification or recovery)
 */
export async function recomputeCardState(
  cardId: string,
  deckSettings?: DeckSettings
): Promise<ComputedCardState> {
  const events = await getCardReviewEvents(cardId);

  if (events.length === 0) {
    return initialCardState(deckSettings || DEFAULT_DECK_SETTINGS);
  }

  // Get deck settings if not provided
  let settings = deckSettings;
  if (!settings) {
    const card = await db.cards.get(cardId);
    if (card) {
      const deck = await db.decks.get(card.deck_id);
      settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;
    } else {
      settings = DEFAULT_DECK_SETTINGS;
    }
  }

  return computeCardState(
    events.map(e => ({ id: e.id, card_id: e.card_id, rating: e.rating, reviewed_at: e.reviewed_at })),
    settings
  );
}

/**
 * Sync unsynced review events to the server
 */
export async function syncReviewEvents(authToken: string | null): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  if (!authToken) {
    return { synced: 0, failed: 0, errors: ['Not authenticated'] };
  }

  const unsyncedEvents = await getUnsyncedReviewEvents(100);

  if (unsyncedEvents.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  try {
    const response = await fetch(`${API_BASE}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        events: unsyncedEvents.map(e => ({
          id: e.id,
          card_id: e.card_id,
          rating: e.rating,
          reviewed_at: e.reviewed_at,
          time_spent_ms: e.time_spent_ms,
          user_answer: e.user_answer,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { synced: 0, failed: unsyncedEvents.length, errors: [error] };
    }

    const result = await response.json() as { created: number; skipped: number };

    // Mark all events as synced
    await markReviewEventsSynced(unsyncedEvents.map(e => e.id));

    // NOTE: deliberately NOT updating the event sync cursor here. The cursor
    // tracks which server events we've DOWNLOADED (by server created_at);
    // advancing it on upload (by client reviewed_at) skipped server events
    // that hadn't been downloaded yet.

    return {
      synced: result.created + result.skipped,
      failed: 0,
      errors: [],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { synced: 0, failed: unsyncedEvents.length, errors: [errorMessage] };
  }
}

/**
 * Download new review events from the server
 */
interface ServerReviewEvent {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: string;
  time_spent_ms: number | null;
  user_answer: string | null;
  // Server insert time — the field the server pages/filters on. Older
  // deployments may omit it, so fall back to reviewed_at when absent.
  created_at?: string;
}

// Safety cap on pagination: 500 pages x 1000 events = 500k events per sync.
const MAX_DOWNLOAD_PAGES = 500;

/** Progress callback for long-running sync operations (feeds the sync badge). */
export type SyncProgressReporter = (message: string, current?: number, total?: number) => void;

export async function downloadReviewEvents(
  authToken: string | null,
  onProgress?: SyncProgressReporter
): Promise<{
  downloaded: number;
  errors: string[];
}> {
  if (!authToken) {
    return { downloaded: 0, errors: ['Not authenticated'] };
  }

  // Cursor = server created_at of the last downloaded event (plus event id as
  // a tie-break within this sync, since batch uploads share created_at).
  const syncMeta = await getEventSyncMeta();
  let since = syncMeta?.last_event_synced_at || '1970-01-01T00:00:00.000Z';
  // Legacy cursors were stored as reviewed_at in ISO format
  // ("2026-07-06T17:45:35.000Z"), which string-compares AHEAD of the server's
  // SQL-format created_at ("2026-07-06 17:45:35") and skipped same-day events.
  // Normalize to SQL format; duplicates are deduped by id below.
  if (since.includes('T')) {
    since = since.replace('T', ' ').replace(/(\.\d+)?Z?$/, '');
  }
  let afterId = '';

  let downloaded = 0;
  const affectedCardIds = new Set<string>();

  try {
    // A fresh device must page through the FULL event history (tens of
    // thousands of events) — a single page produces card state computed from
    // a months-old prefix of reviews and wildly inflated due counts.
    for (let page = 0; page < MAX_DOWNLOAD_PAGES; page++) {
      onProgress?.(downloaded > 0 ? `Downloading reviews (${downloaded} new)` : 'Downloading reviews...');
      const params = new URLSearchParams({ since });
      if (afterId) {
        params.set('after_id', afterId);
      }
      const response = await fetch(`${API_BASE}/api/reviews?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { downloaded, errors: [error] };
      }

      const result = await response.json() as {
        events: ServerReviewEvent[];
        has_more: boolean;
        server_time: string;
      };

      if (result.events.length === 0) {
        break;
      }

      // Store events locally (skip if already exists)
      for (const serverEvent of result.events) {
        const exists = await db.reviewEvents.get(serverEvent.id);
        if (!exists) {
          await createLocalReviewEvent({
            id: serverEvent.id,
            card_id: serverEvent.card_id,
            rating: serverEvent.rating,
            reviewed_at: serverEvent.reviewed_at,
            time_spent_ms: serverEvent.time_spent_ms,
            user_answer: serverEvent.user_answer,
            _synced: 1, // Already on server
          });
          downloaded++;
          affectedCardIds.add(serverEvent.card_id);
        }
      }

      // Advance the cursor to the last event of the page (server orders by
      // created_at, id). Persist per page so an interrupted sync resumes.
      const last = result.events[result.events.length - 1];
      const cursor = last.created_at || last.reviewed_at;
      if (cursor === since && last.id === afterId) {
        // No forward progress — bail rather than loop forever
        break;
      }
      since = cursor;
      afterId = last.id;
      await updateEventSyncMeta(since);

      if (!result.has_more) {
        break;
      }
    }

    // Recompute card state for all affected cards (once, after all pages).
    // This ensures downloaded events are reflected in card scheduling.
    if (affectedCardIds.size > 0) {
      console.log('[downloadReviewEvents] Recomputing state for', affectedCardIds.size, 'cards with new events');
      let done = 0;
      for (const cardId of affectedCardIds) {
        if (done % 20 === 0) {
          onProgress?.('Updating changed cards', done, affectedCardIds.size);
        }
        try {
          await fixCardState(cardId);
        } catch (err) {
          console.error('[downloadReviewEvents] Failed to recompute card state:', cardId, err);
        }
        done++;
      }
    }

    return { downloaded, errors: [] };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { downloaded, errors: [errorMessage] };
  }
}

/**
 * Full two-way reconciliation with the server. Fixes cross-device drift:
 * 1. Re-uploads ALL local events (server dedups by id, so this only fills
 *    server-side gaps, e.g. events once marked synced that never landed).
 * 2. Rewinds the download cursor to the epoch and re-runs the paginated
 *    download (local dedup fills any events this device skipped in the past).
 * Card states for cards that gained events are recomputed by the download.
 */
export async function reconcileAllEvents(
  authToken: string | null,
  onProgress?: SyncProgressReporter
): Promise<{
  local_events: number;
  uploaded_to_server: number;
  orphaned: number;
  downloaded: number;
  errors: string[];
}> {
  if (!authToken) {
    return { local_events: 0, uploaded_to_server: 0, orphaned: 0, downloaded: 0, errors: ['Not authenticated'] };
  }

  const errors: string[] = [];
  const allEvents = await db.reviewEvents.toArray();
  let uploadedToServer = 0;
  let orphaned = 0;

  const UPLOAD_BATCH = 400;
  const totalBatches = Math.ceil(allEvents.length / UPLOAD_BATCH);
  for (let i = 0; i < allEvents.length; i += UPLOAD_BATCH) {
    onProgress?.('Uploading review history', i / UPLOAD_BATCH + 1, totalBatches);
    const chunk = allEvents.slice(i, i + UPLOAD_BATCH);
    try {
      const response = await fetch(`${API_BASE}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          events: chunk.map(e => ({
            id: e.id,
            card_id: e.card_id,
            rating: e.rating,
            reviewed_at: e.reviewed_at,
            time_spent_ms: e.time_spent_ms,
            user_answer: e.user_answer,
          })),
        }),
      });
      if (!response.ok) {
        errors.push(`Upload batch ${i / UPLOAD_BATCH + 1} failed: ${await response.text()}`);
        continue;
      }
      const result = await response.json() as { created: number; skipped_orphans?: number };
      uploadedToServer += result.created;
      // Events for cards deleted server-side — the server refuses them and
      // they have no card to affect; they just stay local.
      orphaned += result.skipped_orphans ?? 0;
    } catch (err) {
      errors.push(`Upload batch ${i / UPLOAD_BATCH + 1} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Everything local is now on the server (or was already)
  if (errors.length === 0) {
    await db.reviewEvents.toCollection().modify({ _synced: 1 });
  }

  // Rewind the cursor and pull the full history; dedup keeps this cheap
  await updateEventSyncMeta('1970-01-01 00:00:00');
  const download = await downloadReviewEvents(authToken, onProgress);
  errors.push(...download.errors);

  return {
    local_events: allEvents.length,
    uploaded_to_server: uploadedToServer,
    orphaned,
    downloaded: download.downloaded,
    errors,
  };
}

/**
 * Verify card state matches computed state from events
 * Returns true if they match, false if there's a mismatch
 */
export async function verifyCardState(cardId: string): Promise<{
  matches: boolean;
  stored: ComputedCardState | null;
  computed: ComputedCardState;
}> {
  const card = await db.cards.get(cardId);
  if (!card) {
    const computed = initialCardState(DEFAULT_DECK_SETTINGS);
    return { matches: true, stored: null, computed };
  }

  const deck = await db.decks.get(card.deck_id);
  const settings = deck ? deckSettingsFromDb(deck) : DEFAULT_DECK_SETTINGS;

  const computed = await recomputeCardState(cardId, settings);

  const stored: ComputedCardState = {
    queue: card.queue,
    // FSRS fields
    stability: card.stability || card.interval || 0,
    difficulty: card.difficulty || 5,
    scheduled_days: card.interval,
    reps: card.repetitions,
    lapses: card.lapses || 0,
    last_reviewed_at: card.last_reviewed_at ?? null,
    // Legacy fields
    learning_step: card.learning_step,
    ease_factor: card.ease_factor,
    interval: card.interval,
    repetitions: card.repetitions,
    next_review_at: card.next_review_at,
    due_timestamp: card.due_timestamp,
  };

  // Compare key fields (focus on FSRS fields). last_reviewed_at is included
  // so cards persisted before the field existed get backfilled by fixCardState
  // on the next Full Sync — without it, interval previews lose the overdue bonus.
  const matches =
    stored.queue === computed.queue &&
    Math.abs(stored.stability - computed.stability) < 0.1 &&
    Math.abs(stored.difficulty - computed.difficulty) < 0.1 &&
    stored.reps === computed.reps &&
    stored.lapses === computed.lapses &&
    stored.last_reviewed_at === computed.last_reviewed_at;

  return { matches, stored, computed };
}

/**
 * Fix card state by recomputing from events.
 * Safety: Never regress a card to NEW if it's currently in a more advanced state
 * and recomputation found no events (possible race condition with event sync).
 */
export async function fixCardState(cardId: string): Promise<ComputedCardState> {
  const computed = await recomputeCardState(cardId);

  // Drop the card's checkpoint: it may predate backfilled (older) events, and
  // checkpoint replay skips events at or before checkpoint_at — so a stale
  // checkpoint would re-bake the wrong baseline on the next review. It's a
  // pure cache; the next review recreates it from the full-replay state.
  await deleteCardCheckpoint(cardId);

  // Safety check: don't reset a card to NEW if it already has progress.
  // This can happen if events haven't been written to IndexedDB yet
  // (e.g., during a study session when sync runs concurrently).
  const currentCard = await db.cards.get(cardId);
  if (currentCard && computed.queue === 0 && currentCard.queue !== 0) {
    // Card has progress but recomputation says NEW - likely missing events
    console.log('[fixCardState] Skipping reset to NEW for card', cardId,
      'current queue:', currentCard.queue,
      'computed queue:', computed.queue,
      '(likely missing events, preserving current state)');
    return computed;
  }

  await db.cards.update(cardId, {
    queue: computed.queue,
    // FSRS fields
    stability: computed.stability,
    difficulty: computed.difficulty,
    lapses: computed.lapses,
    // Legacy fields
    learning_step: computed.learning_step,
    ease_factor: computed.ease_factor,
    interval: computed.interval,
    repetitions: computed.repetitions,
    next_review_at: computed.next_review_at,
    due_timestamp: computed.due_timestamp,
    last_reviewed_at: computed.last_reviewed_at,
    updated_at: new Date().toISOString(),
  });

  return computed;
}

/**
 * Fix ALL card states by recomputing from events.
 * Use this to recover from sync corruption or other issues.
 */
export async function fixAllCardStates(onProgress?: SyncProgressReporter): Promise<{
  total: number;
  fixed: number;
  errors: string[];
}> {
  const allCards = await db.cards.toArray();
  let fixed = 0;
  const errors: string[] = [];

  console.log('[fixAllCardStates] Starting to recompute', allCards.length, 'cards');

  let done = 0;
  for (const card of allCards) {
    if (done % 100 === 0) {
      onProgress?.('Recomputing cards', done, allCards.length);
    }
    done++;
    try {
      const { matches, stored, computed } = await verifyCardState(card.id);
      if (!matches) {
        console.log('[fixAllCardStates] Fixing card', card.id, {
          stored: stored ? { queue: stored.queue, interval: stored.interval, reps: stored.repetitions } : null,
          computed: { queue: computed.queue, interval: computed.interval, reps: computed.repetitions },
        });
        await fixCardState(card.id);
        fixed++;
      }
    } catch (err) {
      const errorMsg = `Failed to fix card ${card.id}: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error('[fixAllCardStates]', errorMsg);
      errors.push(errorMsg);
    }
  }

  console.log('[fixAllCardStates] Complete. Fixed', fixed, 'of', allCards.length, 'cards');

  return { total: allCards.length, fixed, errors };
}
