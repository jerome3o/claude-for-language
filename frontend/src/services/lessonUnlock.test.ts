import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, type LocalCustomLesson } from '../db/database';
import { CardQueue } from '../types';
import { getDueCustomLessons, completeCustomLesson } from './custom-lesson-study';
import { applyLocalUnlocks, listenedHere, markAudioLessonListened, unlockLesson, uploadLessonUnlocks } from './lessonUnlock';

function makeLesson(overrides: Partial<LocalCustomLesson> = {}): LocalCustomLesson {
  return {
    id: overrides.id ?? 'l',
    title: 'Lesson',
    description: null,
    icon: null,
    source: 'mcp',
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    spec: { title: 'Lesson', sections: [{ exercises: [{ type: 'match', pairs: [{ hanzi: '饭', english: 'meal' }, { hanzi: '菜', english: 'dish' }] }] }] },
    queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0, interval: 0, repetitions: 0,
    next_review_at: null, due_timestamp: null, last_reviewed_at: null, _synced_at: null,
    unlock: null, unlocked_at: null, companion_of: null,
    ...overrides,
  };
}

const companion = (over: Partial<LocalCustomLesson> = {}) => makeLesson({
  id: 'companion', title: '去朋友家吃饭 — mini lesson', created_at: '2026-07-01T00:00:00Z',
  unlock: { kind: 'audio_lesson', audio_lesson_id: 'al1' }, companion_of: 'al1', ...over,
});

beforeEach(() => {
  // Offline: nothing uploads during these tests.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
});

describe('unlockable lessons on the device', () => {
  it('a locked lesson is never offered, not even as the oldest new lesson', async () => {
    await db.customLessons.bulkPut([companion(), makeLesson({ id: 'a', created_at: '2026-08-02T00:00:00Z' })]);
    expect((await getDueCustomLessons()).map(l => l.id)).toEqual(['a']);
  });

  it('unlocking puts it in today on top of the daily lesson; finishing it leaves the daily place', async () => {
    await db.customLessons.bulkPut([companion(), makeLesson({ id: 'a', created_at: '2026-08-02T00:00:00Z' })]);
    expect(await unlockLesson('companion', 'manual')).toBe(true);
    expect((await db.lessonUnlocks.get('companion'))?._synced).toBe(0);
    expect((await getDueCustomLessons()).map(l => l.id)).toEqual(['companion', 'a']);
    await completeCustomLesson('companion', 3, 3, 2);
    expect((await getDueCustomLessons()).map(l => l.id)).toEqual(['a']);
    // A second unlock is a no-op.
    expect(await unlockLesson('companion', 'manual')).toBe(false);
  });

  it('a lesson without a condition cannot be unlocked', async () => {
    await db.customLessons.put(makeLesson({ id: 'plain' }));
    expect(await unlockLesson('plain', 'manual')).toBe(false);
    expect(await db.lessonUnlocks.count()).toBe(0);
  });

  it('listening to the end unlocks the lessons waiting on that podcast only', async () => {
    await db.customLessons.bulkPut([
      companion(),
      companion({ id: 'other', companion_of: 'al2', unlock: { kind: 'audio_lesson', audio_lesson_id: 'al2' } }),
      companion({ id: 'manual', unlock: { kind: 'manual', prompt: 'Order 打包' } }),
    ]);
    expect(await markAudioLessonListened('al1')).toEqual(['companion']);
    expect(listenedHere('al1')).not.toBeNull();
    expect((await db.lessonUnlocks.get('companion'))?.via).toBe('auto');
    expect((await db.customLessons.get('other'))?.unlocked_at).toBeNull();
    expect((await db.customLessons.get('manual'))?.unlocked_at).toBeNull();
  });

  it('after a sync rebuilt the cache, pending unlocks stay; ones the server has are forgotten', async () => {
    await db.customLessons.put(companion());
    await unlockLesson('companion', 'manual');
    const at = (await db.lessonUnlocks.get('companion'))!.unlocked_at;
    // The sync rebuilt the row from the server, which doesn't have it yet.
    await db.customLessons.put(companion());
    await applyLocalUnlocks();
    expect((await db.customLessons.get('companion'))?.unlocked_at).toBe(at);
    // Uploaded, and the server's list carries it now → the local row goes.
    await db.lessonUnlocks.update('companion', { _synced: 1 });
    await db.customLessons.put(companion({ unlocked_at: at }));
    await applyLocalUnlocks();
    expect(await db.lessonUnlocks.count()).toBe(0);
  });

  it('uploads pending unlocks (idempotent by lesson) and drops ones the server does not know', async () => {
    await db.customLessons.bulkPut([companion(), companion({ id: 'gone' })]);
    await unlockLesson('companion', 'manual');
    await unlockLesson('gone', 'manual');
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.events.map((e: { lesson_id: string }) => e.lesson_id).sort()).toEqual(['companion', 'gone']);
      return new Response(JSON.stringify({ unlocked: ['companion'], already: [], not_found: ['gone'] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await uploadLessonUnlocks()).toEqual({ uploaded: 1 });
      expect((await db.lessonUnlocks.get('companion'))?._synced).toBe(1);
      expect(await db.lessonUnlocks.get('gone')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
