/**
 * "Delete lesson" is offline-first: the lesson leaves the device at once and stays gone through a sync
 * until the server has the DELETE (a 404 = already gone).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./offlineMode', () => ({ isEffectivelyOffline: () => true }));

import { db } from '../db/database';
import { deleteLessonOfflineFirst, pendingLessonDeletes, uploadLessonDeletes } from './lessonDeletes';

const lesson = (id: string) => ({
  id, title: id, description: null, icon: null, source: 'chat', status: 'active', created_at: '2026-10-20T00:00:00Z',
  spec: { title: id, sections: [] }, queue: 0, stability: 0, difficulty: 0, lapses: 0, interval: 0, repetitions: 0,
  next_review_at: null, due_timestamp: null, last_reviewed_at: null, _synced_at: 0,
});

beforeEach(async () => {
  localStorage.clear();
  await db.customLessons.clear();
  await db.customLessonCompletionEvents.clear();
});

describe('deleteLessonOfflineFirst', () => {
  it('removes the lesson and its runs here at once, offline; the DELETE waits for the sync', async () => {
    await db.customLessons.bulkPut([lesson('old-test'), lesson('keep')] as never);
    await db.customLessonCompletionEvents.put({ id: 'c1', lesson_id: 'old-test', correct: 1, total: 2, completed_at: '2026-10-21T00:00:00Z', rating: null, _synced: 1 } as never);
    await deleteLessonOfflineFirst('old-test');
    expect((await db.customLessons.toArray()).map((l) => l.id)).toEqual(['keep']);
    expect(await db.customLessonCompletionEvents.count()).toBe(0);
    expect([...pendingLessonDeletes()]).toEqual(['old-test']);

    const fetchMock = vi.fn(async (_url: string) => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await uploadLessonDeletes()).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/custom-lessons/old-test');
    expect(pendingLessonDeletes().size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('keeps the delete pending when the server is unreachable', async () => {
    await deleteLessonOfflineFirst('x');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    expect(await uploadLessonDeletes()).toBe(0);
    expect([...pendingLessonDeletes()]).toEqual(['x']);
    vi.unstubAllGlobals();
  });
});
