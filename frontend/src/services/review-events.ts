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

// Generate unique IDs for events
function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// API base URL
const API_BASE = '';

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
    _synced: false,
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
    learning_step: newState.learning_step,
    ease_factor: newState.ease_factor,
    interval: newState.interval,
    repetitions: newState.repetitions,
    next_review_at: newState.next_review_at,
    due_timestamp: newState.due_timestamp,
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

    // Update sync metadata
    const latestEvent = unsyncedEvents.reduce((latest, e) =>
      e.reviewed_at > latest.reviewed_at ? e : latest
    );
    await updateEventSyncMeta(latestEvent.reviewed_at);

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
export async function downloadReviewEvents(authToken: string | null): Promise<{
  downloaded: number;
  errors: string[];
}> {
  if (!authToken) {
    return { downloaded: 0, errors: ['Not authenticated'] };
  }

  // Get last sync timestamp
  const syncMeta = await getEventSyncMeta();
  const since = syncMeta?.last_event_synced_at || '1970-01-01T00:00:00.000Z';

  try {
    const response = await fetch(`${API_BASE}/api/reviews?since=${encodeURIComponent(since)}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return { downloaded: 0, errors: [error] };
    }

    const result = await response.json() as {
      events: Array<{
        id: string;
        card_id: string;
        rating: Rating;
        reviewed_at: string;
        time_spent_ms: number | null;
        user_answer: string | null;
      }>;
      has_more: boolean;
      server_time: string;
    };

    // Store events locally (skip if already exists)
    let downloaded = 0;
    const affectedCardIds = new Set<string>();

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
          _synced: true, // Already on server
        });
        downloaded++;
        affectedCardIds.add(serverEvent.card_id);
      }
    }

    // Recompute card state for all affected cards
    // This ensures downloaded events are reflected in card scheduling
    if (affectedCardIds.size > 0) {
      console.log('[downloadReviewEvents] Recomputing state for', affectedCardIds.size, 'cards with new events');
      for (const cardId of affectedCardIds) {
        try {
          await fixCardState(cardId);
        } catch (err) {
          console.error('[downloadReviewEvents] Failed to recompute card state:', cardId, err);
        }
      }
    }

    // Update sync metadata
    if (result.events.length > 0) {
      const latestEvent = result.events.reduce((latest, e) =>
        e.reviewed_at > latest.reviewed_at ? e : latest
      );
      await updateEventSyncMeta(latestEvent.reviewed_at);
    }

    return { downloaded, errors: [] };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { downloaded: 0, errors: [errorMessage] };
  }
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
    learning_step: card.learning_step,
    ease_factor: card.ease_factor,
    interval: card.interval,
    repetitions: card.repetitions,
    next_review_at: card.next_review_at,
    due_timestamp: card.due_timestamp,
  };

  // Compare key fields
  const matches =
    stored.queue === computed.queue &&
    stored.learning_step === computed.learning_step &&
    Math.abs(stored.ease_factor - computed.ease_factor) < 0.001 &&
    stored.interval === computed.interval &&
    stored.repetitions === computed.repetitions;

  return { matches, stored, computed };
}

/**
 * Fix card state by recomputing from events
 */
export async function fixCardState(cardId: string): Promise<ComputedCardState> {
  const computed = await recomputeCardState(cardId);

  await db.cards.update(cardId, {
    queue: computed.queue,
    learning_step: computed.learning_step,
    ease_factor: computed.ease_factor,
    interval: computed.interval,
    repetitions: computed.repetitions,
    next_review_at: computed.next_review_at,
    due_timestamp: computed.due_timestamp,
    updated_at: new Date().toISOString(),
  });

  return computed;
}

/**
 * Fix ALL card states by recomputing from events.
 * Use this to recover from sync corruption or other issues.
 */
export async function fixAllCardStates(): Promise<{
  total: number;
  fixed: number;
  errors: string[];
}> {
  const allCards = await db.cards.toArray();
  let fixed = 0;
  const errors: string[] = [];

  console.log('[fixAllCardStates] Starting to recompute', allCards.length, 'cards');

  for (const card of allCards) {
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
