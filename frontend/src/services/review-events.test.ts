import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadReviewEvents, reconcileAllEvents } from './review-events';
import { db, createLocalReviewEvent, getEventSyncMeta, updateEventSyncMeta } from '../db/database';
import type { Rating } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function serverEvent(id: string, createdAt: string) {
  return {
    id,
    card_id: `card-${id}`,
    rating: 2 as Rating, // good
    reviewed_at: createdAt.replace(' ', 'T') + '.000Z',
    time_spent_ms: 1000,
    user_answer: null,
    created_at: createdAt,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('downloadReviewEvents', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('pages through the full history when has_more is set', async () => {
    const page1 = [serverEvent('a1', '2026-01-01 10:00:00'), serverEvent('a2', '2026-01-01 10:00:00')];
    const page2 = [serverEvent('b1', '2026-02-01 10:00:00')];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ events: page1, has_more: true, server_time: 'x' }))
      .mockResolvedValueOnce(jsonResponse({ events: page2, has_more: false, server_time: 'x' }));

    const result = await downloadReviewEvents('token');

    expect(result.downloaded).toBe(3);
    expect(result.errors).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await db.reviewEvents.count()).toBe(3);

    // Second request must resume from the tuple cursor of page 1's last event
    const secondUrl = new URL(mockFetch.mock.calls[1][0], 'http://localhost');
    expect(secondUrl.searchParams.get('since')).toBe('2026-01-01 10:00:00');
    expect(secondUrl.searchParams.get('after_id')).toBe('a2');

    // Cursor persisted as the server's created_at format
    const meta = await getEventSyncMeta();
    expect(meta?.last_event_synced_at).toBe('2026-02-01 10:00:00');
  });

  it('normalizes legacy ISO cursors to SQL timestamp format', async () => {
    await updateEventSyncMeta('2026-07-06T17:45:35.000Z');
    mockFetch.mockResolvedValueOnce(jsonResponse({ events: [], has_more: false, server_time: 'x' }));

    await downloadReviewEvents('token');

    const url = new URL(mockFetch.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('since')).toBe('2026-07-06 17:45:35');
    expect(url.searchParams.get('after_id')).toBeNull();
  });

  it('stops when the server makes no forward progress', async () => {
    const page = [serverEvent('x1', '2026-01-01 10:00:00')];
    // Server (incorrectly) keeps returning the same page with has_more: true
    mockFetch.mockResolvedValue(jsonResponse({ events: page, has_more: true, server_time: 'x' }));

    const result = await downloadReviewEvents('token');

    expect(result.errors).toEqual([]);
    // First page stores the event; second page makes no cursor progress -> stop
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await db.reviewEvents.count()).toBe(1);
  });

  it('deduplicates events that already exist locally', async () => {
    const page = [serverEvent('dup', '2026-01-01 10:00:00')];
    mockFetch.mockResolvedValueOnce(jsonResponse({ events: page, has_more: false, server_time: 'x' }));
    await downloadReviewEvents('token');

    mockFetch.mockResolvedValueOnce(jsonResponse({ events: page, has_more: false, server_time: 'x' }));
    const second = await downloadReviewEvents('token');

    expect(second.downloaded).toBe(0);
    expect(await db.reviewEvents.count()).toBe(1);
  });

  it('reconcile uploads all local events and backfills from the epoch', async () => {
    // Two local events, one already "synced" — reconcile re-uploads BOTH
    await createLocalReviewEvent({
      id: 'local-1', card_id: 'card-a', rating: 2 as Rating,
      reviewed_at: '2026-03-01T10:00:00.000Z', time_spent_ms: 900, user_answer: null, _synced: 1,
    });
    await createLocalReviewEvent({
      id: 'local-2', card_id: 'card-b', rating: 0 as Rating,
      reviewed_at: '2026-03-02T10:00:00.000Z', time_spent_ms: 800, user_answer: null, _synced: 0,
    });
    // Cursor mid-history: reconcile must rewind it, not resume from it
    await updateEventSyncMeta('2026-06-01 00:00:00');

    const serverOnly = serverEvent('server-1', '2026-02-01 09:00:00');
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body as string) as { events: unknown[] };
        // Server already has local-1; only local-2 is new
        return jsonResponse({ created: body.events.length - 1, skipped: 1 });
      }
      // Download leg: must start from the epoch, not the stored cursor
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.searchParams.get('since')).toBe('1970-01-01 00:00:00');
      return jsonResponse({ events: [serverOnly], has_more: false, server_time: 'x' });
    });

    const result = await reconcileAllEvents('token');

    expect(result.local_events).toBe(2);
    expect(result.uploaded_to_server).toBe(1);
    expect(result.downloaded).toBe(1); // the server-only event was backfilled
    expect(result.errors).toEqual([]);
    expect(await db.reviewEvents.count()).toBe(3);
    // Everything local is marked synced after a clean upload
    expect(await db.reviewEvents.where('_synced').equals(0).count()).toBe(0);
  });

  it('keeps events from earlier pages when a later page fails', async () => {
    const page1 = [serverEvent('p1', '2026-01-01 10:00:00')];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ events: page1, has_more: true, server_time: 'x' }))
      .mockResolvedValueOnce({ ok: false, text: async () => 'boom' } as unknown as Response);

    const result = await downloadReviewEvents('token');

    expect(result.downloaded).toBe(1);
    expect(result.errors).toEqual(['boom']);
    // Cursor persisted through page 1, so the retry resumes rather than restarting
    const meta = await getEventSyncMeta();
    expect(meta?.last_event_synced_at).toBe('2026-01-01 10:00:00');
  });
});
