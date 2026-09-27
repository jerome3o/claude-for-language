import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  db,
  addPendingReviewDeletion,
  getPendingReviewDeletions,
  getPendingReviewDeletionIds,
  removePendingReviewDeletion,
  createLocalReviewEvent,
} from '../db/database';
import { processPendingReviewDeletions, downloadReviewEvents } from './review-events';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Undo review support', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('pending review deletions queue', () => {
    it('adds, lists and removes pending deletions', async () => {
      await addPendingReviewDeletion('event-1');
      await addPendingReviewDeletion('event-2');

      const pending = await getPendingReviewDeletions();
      expect(pending.map(p => p.id).sort()).toEqual(['event-1', 'event-2']);

      const ids = await getPendingReviewDeletionIds();
      expect(ids.has('event-1')).toBe(true);
      expect(ids.has('event-2')).toBe(true);

      await removePendingReviewDeletion('event-1');
      const remaining = await getPendingReviewDeletions();
      expect(remaining.map(p => p.id)).toEqual(['event-2']);
    });
  });

  describe('processPendingReviewDeletions', () => {
    it('does nothing without an auth token', async () => {
      await addPendingReviewDeletion('event-1');
      const result = await processPendingReviewDeletions(null);
      expect(result.processed).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
      expect((await getPendingReviewDeletions()).length).toBe(1);
    });

    it('deletes on the server and clears the queue on success', async () => {
      await addPendingReviewDeletion('event-1');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: true }),
      });

      const result = await processPendingReviewDeletions('token');
      expect(result.processed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/reviews/event-1'),
        expect.objectContaining({ method: 'DELETE' })
      );
      expect((await getPendingReviewDeletions()).length).toBe(0);
    });

    it('keeps the pending deletion when the server errors', async () => {
      await addPendingReviewDeletion('event-1');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom',
      });

      const result = await processPendingReviewDeletions('token');
      expect(result.processed).toBe(0);
      expect(result.errors.length).toBe(1);
      expect((await getPendingReviewDeletions()).length).toBe(1);
    });

    it('clears the pending deletion on 404 (already gone)', async () => {
      await addPendingReviewDeletion('event-1');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      });

      const result = await processPendingReviewDeletions('token');
      expect(result.processed).toBe(1);
      expect((await getPendingReviewDeletions()).length).toBe(0);
    });
  });

  describe('downloadReviewEvents with pending deletions', () => {
    it('does not resurrect an undone event from a server download', async () => {
      // The undone event is queued for server deletion but still present in
      // the server's event feed (deletion hasn't been pushed yet).
      await addPendingReviewDeletion('undone-event');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 'undone-event',
              card_id: 'card-1',
              rating: 2,
              reviewed_at: '2026-01-01T10:00:00.000Z',
              time_spent_ms: 1000,
              user_answer: null,
              created_at: '2026-01-01 10:00:00',
            },
            {
              id: 'other-event',
              card_id: 'card-2',
              rating: 2,
              reviewed_at: '2026-01-01T10:01:00.000Z',
              time_spent_ms: 1000,
              user_answer: null,
              created_at: '2026-01-01 10:01:00',
            },
          ],
          has_more: false,
          server_time: '2026-01-01T10:02:00.000Z',
        }),
      });

      const result = await downloadReviewEvents('token');
      expect(result.errors).toEqual([]);
      expect(result.downloaded).toBe(1);

      expect(await db.reviewEvents.get('undone-event')).toBeUndefined();
      expect(await db.reviewEvents.get('other-event')).toBeDefined();
    });

    it('still downloads the event once the deletion queue is clear', async () => {
      await createLocalReviewEvent({
        id: 'existing-event',
        card_id: 'card-1',
        rating: 2,
        time_spent_ms: 1000,
        user_answer: null,
        reviewed_at: '2026-01-01T09:00:00.000Z',
        _synced: 1,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            {
              id: 'new-event',
              card_id: 'card-1',
              rating: 2,
              reviewed_at: '2026-01-01T10:00:00.000Z',
              time_spent_ms: 1000,
              user_answer: null,
              created_at: '2026-01-01 10:00:00',
            },
          ],
          has_more: false,
          server_time: '2026-01-01T10:02:00.000Z',
        }),
      });

      const result = await downloadReviewEvents('token');
      expect(result.errors).toEqual([]);
      expect(result.downloaded).toBe(1);
      expect(await db.reviewEvents.get('new-event')).toBeDefined();
    });
  });
});
