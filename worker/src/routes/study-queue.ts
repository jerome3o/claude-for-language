/**
 * Today's study queue as the server sees it (services/study-queue.ts — the shared
 * `selectStudyQueue` / `countQueue` over the account's cards). Mounted under /api after auth.
 *
 *   GET /me/study-queue?deck_id=&per_deck=1&limit=N
 *     → { day_key, due_today, reviews_due, new_today, counts: { new, extra_new, learning, review },
 *         new_cards_paused,
 *         decks?: [{ deck_id, due_today, reviews_due, new_today, counts }]   (per_deck=1: each deck's OWN session)
 *         cards?: [{ id, note_id, deck_id, card_type, queue }] }            (limit: the first N, session order)
 *
 *   `due_today` = what Home's Study button counts (reviews due + today's new cards, the budget's);
 *   `reviews_due` = learning + review cards due today, no new cards. The MCP server reads it
 *   (list_decks, get_due_cards, get_overall_stats, study).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { computeStudyQueue, loadStudyQueueInputs, perDeckDue } from '../services/study-queue';

const studyQueue = new Hono<{ Bindings: Env }>();

studyQueue.get('/me/study-queue', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.query('deck_id') || null;
  const limit = Math.max(0, Math.min(200, parseInt(c.req.query('limit') || '0', 10) || 0));
  const inputs = await loadStudyQueueInputs(c.env.DB, userId);
  if (deckId && !inputs.decks.some((d) => d.id === deckId)) return c.json({ error: 'Deck not found' }, 404);
  const queue = computeStudyQueue(inputs, deckId);
  const { due, cutoff_ms: _cutoff, ...summary } = queue;
  return c.json({
    ...summary,
    ...(c.req.query('per_deck') === '1'
      ? { decks: [...perDeckDue(inputs)].map(([deck_id, d]) => ({ deck_id, ...d })) }
      : {}),
    ...(limit > 0
      ? { cards: due.slice(0, limit).map((card) => ({ id: card.id, note_id: card.note_id, deck_id: card.deck_id, card_type: card.card_type, queue: card.queue })) }
      : {}),
  });
});

export default studyQueue;
