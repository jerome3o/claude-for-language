/**
 * Review events — the single source of truth for card scheduling (CLAUDE.md "Event-Sourcing
 * Architecture"): the offline upload, the download since a cursor, Undo, one card's events, and the
 * whole-account replay. Every write leaves the card's cached state = the replay of its events
 * through ONE function, `recomputeCards` (services/card-state.ts).
 */
import { Hono } from 'hono';
import type { Env, Rating } from '../types';
import * as db from '../db/queries';
import { ownRecordingKey } from '../services/audio';
import { recomputeCards, runCardStateRepair } from '../services/card-state';

const reviews = new Hono<{ Bindings: Env }>();

// Upload batch of review events (from offline sync)
reviews.post('/reviews', async (c) => {
  const userId = c.get('user').id;
  const { events } = await c.req.json<{
    events: Array<{
      id: string;
      card_id: string;
      rating: Rating;
      reviewed_at: string;
      time_spent_ms?: number;
      user_answer?: string;
    }>;
  }>();

  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events array is required' }, 400);
  }

  if (events.length === 0) {
    return c.json({ created: 0, skipped: 0 });
  }

  // Validate all events have required fields
  for (const event of events) {
    if (!event.id || !event.card_id || event.rating === undefined || !event.reviewed_at) {
      return c.json({ error: 'Each event must have id, card_id, rating, and reviewed_at' }, 400);
    }
  }

  // Verify which cards belong to this user — chunked IN queries instead of
  // one query per card, so large reconcile uploads stay under the Workers
  // subrequest cap.
  const cardIds = [...new Set(events.map(e => e.card_id))];
  const validCardIds = new Set<string>();
  const CARD_CHECK_CHUNK = 90;
  for (let i = 0; i < cardIds.length; i += CARD_CHECK_CHUNK) {
    const chunk = cardIds.slice(i, i + CARD_CHECK_CHUNK);
    const rows = await c.env.DB.prepare(`
      SELECT c.id FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ? AND c.id IN (${chunk.map(() => '?').join(',')})
    `).bind(userId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) {
      validCardIds.add(row.id);
    }
  }

  // Filter events to only include valid cards, skip orphaned events
  const validEvents = events.filter(e => validCardIds.has(e.card_id));
  const skippedOrphans = events.length - validEvents.length;

  if (skippedOrphans > 0) {
    console.log(`[API reviews] Skipping ${skippedOrphans} events for deleted/missing cards`);
  }

  // Create events with user_id added. A recording is only ever stored at the key the server
  // derives from the event id (POST /api/audio/upload); any other key an event carries is dropped
  // — it made the media check treat the caller as an owner of someone else's recording.
  const eventsWithUser = validEvents.map(e => ({
    ...e,
    recording_url: ownRecordingKey(e.id, (e as { recording_url?: unknown }).recording_url) ?? undefined,
    user_id: userId,
  }));

  const result = eventsWithUser.length > 0
    ? await db.createReviewEventsBatch(c.env.DB, eventsWithUser)
    : { created: 0, skipped: 0 };

  // Update sync metadata with the latest event timestamp
  if (events.length > 0) {
    const latestEvent = events.reduce((latest, e) =>
      e.reviewed_at > latest.reviewed_at ? e : latest
    );
    await db.updateSyncMetadata(c.env.DB, userId, latestEvent.reviewed_at);
  }

  // Recompute the cached state of every card the upload touched — ALSO when every event was
  // already stored (a retried upload whose first attempt died after the insert used to skip it,
  // leaving the cache behind its events). services/card-state.ts: the one replay write.
  if (validEvents.length > 0) {
    await recomputeCards(c.env.DB, userId, validEvents.map(e => e.card_id));
  }

  // Events for cards this account doesn't have are refused. The client marks
  // the accepted ones synced and these as rejected (`_synced = -1`), instead of
  // pretending the server holds them.
  const validIds = new Set(validEvents.map(e => e.id));
  return c.json({
    ...result,
    skipped_orphans: skippedOrphans,
    orphan_event_ids: events.filter(e => !validIds.has(e.id)).map(e => e.id),
  });
});

// Get review events since a timestamp (for sync)
reviews.get('/reviews', async (c) => {
  const userId = c.get('user').id;
  const since = c.req.query('since');
  const afterId = c.req.query('after_id') || '';
  const limit = parseInt(c.req.query('limit') || '1000', 10);

  if (!since) {
    return c.json({ error: 'since parameter is required (ISO timestamp)' }, 400);
  }

  const events = await db.getReviewEventsSince(c.env.DB, userId, since, limit, afterId);

  // Get sync metadata
  const metadata = await db.getSyncMetadata(c.env.DB, userId);

  return c.json({
    events,
    has_more: events.length >= limit,
    server_time: new Date().toISOString(),
    last_sync_at: metadata?.last_sync_at || null,
  });
});

// Delete a single review event (Undo on the study page). Events are normally
// append-only; undo is the deliberate exception. The client deletes the event
// locally and calls this so a later download/full sync can't resurrect it.
// The card's state is recomputed from the remaining events.
reviews.delete('/reviews/:id', async (c) => {
  const userId = c.get('user').id;
  const eventId = c.req.param('id');

  const event = await c.env.DB.prepare(
    'SELECT id, card_id FROM review_events WHERE id = ? AND user_id = ?'
  ).bind(eventId, userId).first<{ id: string; card_id: string }>();

  if (!event) {
    // Already gone or never uploaded — report success so the client can clear
    // its pending-deletion queue.
    return c.json({ deleted: false });
  }

  await c.env.DB.prepare('DELETE FROM review_events WHERE id = ? AND user_id = ?')
    .bind(eventId, userId).run();

  // The card's state from its remaining reviews + live forgets (a card with neither is NEW).
  await recomputeCards(c.env.DB, userId, [event.card_id]);

  return c.json({ deleted: true });
});

// Get review events for a specific card
reviews.get('/cards/:id/events', async (c) => {
  const userId = c.get('user').id;
  const cardId = c.req.param('id');

  // Verify card ownership
  const card = await db.getCardById(c.env.DB, cardId, userId);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }

  const events = await db.getCardReviewEvents(c.env.DB, cardId, userId);

  return c.json({ events });
});

// Recompute all card states from review events (for fixing stale card data): every card of the
// account replayed — a card with no events is NEW — and only the differing rows rewritten.
reviews.post('/cards/recompute-states', async (c) => {
  const userId = c.get('user').id;
  const r = await runCardStateRepair(c.env.DB, userId, { restart: true });
  return c.json({
    total_cards: r.scanned,
    differing: r.differing,
    updated: r.written,
    errors: 0,
    transitions: r.transitions,
  });
});

export default reviews;
