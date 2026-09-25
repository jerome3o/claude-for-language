import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, updateSyncMeta } from '../db/database';
import { CardQueue } from '../types';

const mockFetch = vi.fn();
global.fetch = mockFetch;
const { syncService } = await import('./sync');

const now = new Date().toISOString();
async function seedDeck(deckId: string, noteIds: string[]) {
  await db.decks.put({ id: deckId, user_id: 'u', name: deckId, description: null, new_cards_per_day: 20, request_retention: 0.9, fsrs_weights: null, learning_steps: '1 10', graduating_interval: 1, easy_interval: 4, relearning_steps: '10', starting_ease: 2.5, minimum_ease: 1.3, maximum_ease: 3, interval_modifier: 1, hard_multiplier: 1.2, easy_bonus: 1.3, maximum_interval: 36500, created_at: now, updated_at: now, _synced_at: null });
  for (const n of noteIds) {
    await db.notes.put({ id: n, deck_id: deckId, hanzi: n, pinyin: 'x', english: 'y', audio_url: null, audio_provider: null, fun_facts: null, context: null, sentence_clue: null, sentence_clue_pinyin: null, sentence_clue_translation: null, sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null, created_at: now, updated_at: now, _synced_at: null });
    await db.cards.put({ id: `${n}-h`, note_id: n, deck_id: deckId, card_type: 'hanzi_to_meaning', queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null, created_at: now, updated_at: now, _synced_at: null });
  }
}

describe('incremental sync applies server deletions', () => {
  beforeEach(async () => {
    mockFetch.mockReset();
    (syncService as any).isSyncing = false;
    (syncService as any).pendingFullSync = false;
    (syncService as any).syncPromise = null;
    await updateSyncMeta({ id: 'sync_state', last_full_sync: Date.now() - 86400000, last_incremental_sync: Date.now() - 3600000, user_id: 'u' });
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sync/changes')) {
        return { ok: true, json: async () => ({ decks: [], notes: [], cards: [], deleted: { deck_ids: ['d-gone'], note_ids: ['n-gone'], card_ids: [] }, server_time: new Date().toISOString() }) };
      }
      if (url.includes('/api/decks')) return { ok: true, json: async () => [] };
      return { ok: false, status: 404, text: async () => 'Not mocked', json: async () => ({}) };
    });
  });

  it('removes a deleted deck with its notes and cards, and a deleted note with its cards', async () => {
    await seedDeck('d-gone', ['n1', 'n2']);
    await seedDeck('d-keep', ['n-gone', 'n-keep']);
    await syncService.incrementalSync();
    expect((await db.decks.toArray()).map(d => d.id)).toEqual(['d-keep']);
    expect((await db.notes.toArray()).map(n => n.id).sort()).toEqual(['n-keep']);
    expect((await db.cards.toArray()).map(c => c.id)).toEqual(['n-keep-h']);
  });
});

// A deck deleted on this device while a sync is in flight must stay deleted:
// the sync carries a snapshot from before the delete.
describe('a sync in flight does not bring back a deck deleted meanwhile', () => {
  const serverDeck = (id: string) => ({
    id, user_id: 'u', name: id, description: null, new_cards_per_day: 3, created_at: now, updated_at: now,
    notes: [{ id: `${id}-n`, deck_id: id, hanzi: '一边', pinyin: 'yìbiān', english: 'while', created_at: now, updated_at: now,
      cards: [{ id: `${id}-n-h`, note_id: `${id}-n`, card_type: 'hanzi_to_meaning', created_at: now, updated_at: now }] }],
  });
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const notMocked = { ok: false, status: 500, text: async () => 'Not mocked', json: async () => ({}) };

  beforeEach(async () => {
    mockFetch.mockReset();
    (syncService as any).isSyncing = false;
    (syncService as any).pendingFullSync = false;
    (syncService as any).syncPromise = null;
    await db.decks.clear();
    await db.notes.clear();
    await db.cards.clear();
  });

  it('full sync: leaves out a deck deleted during the sync and keeps the cursor before the delete', async () => {
    const { removeDecksLocally, getSyncMeta } = await import('../db/database');
    let deletedAt = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/decks')) return ok([{ id: 'd-deleted' }, { id: 'd-other' }]);
      if (url.endsWith('/api/decks/d-deleted')) return ok(serverDeck('d-deleted'));
      if (url.endsWith('/api/decks/d-other')) {
        // The user presses Delete on d-deleted while the sync is still loading decks
        await new Promise(r => setTimeout(r, 5));
        deletedAt = Date.now();
        await removeDecksLocally(['d-deleted']);
        return ok(serverDeck('d-other'));
      }
      return notMocked;
    });
    await syncService.fullSync().catch(() => undefined);
    expect((await db.decks.toArray()).map(d => d.id)).toEqual(['d-other']);
    expect((await db.notes.toArray()).map(n => n.id)).toEqual(['d-other-n']);
    expect((await db.cards.toArray()).map(c => c.id)).toEqual(['d-other-n-h']);
    // The next incremental sync asks from before the delete, so its tombstone arrives
    expect((await getSyncMeta())!.last_incremental_sync!).toBeLessThan(deletedAt);
  });

  it('full sync: a deck deleted on the server between the list and its fetch is skipped, not fatal', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/decks')) return ok([{ id: 'd-server-gone' }, { id: 'd-live' }]);
      if (url.endsWith('/api/decks/d-server-gone')) return { ok: false, status: 404, json: async () => ({ error: 'Deck not found' }) };
      if (url.endsWith('/api/decks/d-live')) return ok(serverDeck('d-live'));
      return notMocked;
    });
    await syncService.fullSync();
    expect((await db.decks.toArray()).map(d => d.id)).toEqual(['d-live']);
  });

  it('incremental sync: skips a deck this device deleted after the server built the response', async () => {
    const { removeDecksLocally } = await import('../db/database');
    await seedDeck('d-local-del', ['n-local-del']);
    await updateSyncMeta({ id: 'sync_state', last_full_sync: Date.now() - 86400000, last_incremental_sync: Date.now() - 3600000, user_id: 'u' });
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/sync/changes')) {
        const d = serverDeck('d-local-del');
        const body = { decks: [d], notes: d.notes.map(({ cards: _c, ...n }) => n), cards: d.notes[0].cards, deleted: { deck_ids: [], note_ids: [], card_ids: [] }, server_time: new Date().toISOString() };
        await removeDecksLocally(['d-local-del']); // deleted while the response was on its way
        return ok(body);
      }
      return notMocked;
    });
    await syncService.incrementalSync().catch(() => undefined);
    expect(await db.decks.get('d-local-del')).toBeUndefined();
    expect(await db.notes.get('d-local-del-n')).toBeUndefined();
    expect(await db.cards.get('d-local-del-n-h')).toBeUndefined();
  });
});
