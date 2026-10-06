import { describe, it, expect } from 'vitest';
import {
  getDueReaders,
  recordReaderReview,
  fixReaderState,
  isStudyableReader,
  getReaderIntervalPreviews,
  READERS_PER_DAY,
  pickTodaysReader,
} from './reader-study';
import { readerTtsKey } from './readerSync';
import { db, LocalReader } from '../db/database';
import { CardQueue } from '../types';

function makeReader(overrides: Partial<LocalReader> = {}): LocalReader {
  const id = overrides.id ?? `reader-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title_chinese: '小明的一天',
    title_english: "Xiao Ming's Day",
    difficulty_level: 'beginner',
    status: 'ready',
    created_at: new Date().toISOString(),
    pages: [
      {
        id: `${id}-p1`,
        page_number: 1,
        content_chinese: '小明早上七点起床。',
        content_pinyin: 'xiǎo míng zǎo shang qī diǎn qǐ chuáng.',
        content_english: 'Xiao Ming gets up at seven in the morning.',
        image_url: 'reader-images/p1.png',
        image_prompt: 'A boy waking up in the morning',
      },
    ],
    queue: CardQueue.NEW,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    due_timestamp: null,
    last_reviewed_at: null,
    _synced_at: null,
    ...overrides,
  };
}

describe('isStudyableReader', () => {
  it('requires ready status and at least one page', () => {
    expect(isStudyableReader(makeReader())).toBe(true);
    expect(isStudyableReader(makeReader({ status: 'generating' }))).toBe(false);
    expect(isStudyableReader(makeReader({ status: 'failed' }))).toBe(false);
    expect(isStudyableReader(makeReader({ pages: [] }))).toBe(false);
  });
});

describe('recordReaderReview', () => {
  it('creates an unsynced event; Good brings the story back in two weeks', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    const { event, newState } = await recordReaderReview(reader.id, 2, 30_000);

    expect(event.reader_id).toBe(reader.id);
    expect(event._synced).toBe(0);
    expect(newState.status).toBe('scheduled');
    expect(newState.gap_days).toBe(14);

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.REVIEW);
    expect(stored?.due_timestamp).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    const events = await db.readerReviewEvents.toArray();
    expect(events).toHaveLength(1);
  });

  it('Again brings it back tomorrow, not later today', async () => {
    const reader = makeReader();
    await db.readers.put(reader);
    const { newState } = await recordReaderReview(reader.id, 0, 30_000);
    expect(newState.gap_days).toBe(1);
    expect(newState.due_ms).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('state is derived from the full event history (the gap grows)', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    await recordReaderReview(reader.id, 2, 1000);
    await recordReaderReview(reader.id, 2, 1000);
    const { newState } = await recordReaderReview(reader.id, 2, 1000);

    expect(newState.finishes).toBe(3);
    expect(newState.gap_days).toBe(56);
    expect(await db.readerReviewEvents.count()).toBe(3);
  });

  it('Done for good retires it', async () => {
    const reader = makeReader({ id: 'r-dfg' });
    await db.readers.put(reader);
    const { newState } = await recordReaderReview(reader.id, 2, 1000, { retire: true });
    expect(newState.status).toBe('retired');
    expect((await db.readers.get('r-dfg'))?.retired).toBe(true);
  });
});

describe('fixReaderState', () => {
  it('repairs a drifted cached state from events', async () => {
    const reader = makeReader();
    await db.readers.put(reader);
    await recordReaderReview(reader.id, 3, 1000); // Easy → six weeks

    // Corrupt the cached state
    await db.readers.update(reader.id, { queue: CardQueue.NEW, repetitions: 0 });

    const computed = await fixReaderState(reader.id);
    expect(computed.status).toBe('scheduled');
    expect(computed.gap_days).toBe(42);

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.REVIEW);
    expect(stored?.repetitions).toBe(1);
  });
});

describe('getDueReaders — one reader a day', () => {
  it('is at most one reader', () => {
    expect(READERS_PER_DAY).toBe(1);
  });

  it('excludes generating/failed/empty readers', async () => {
    await db.readers.bulkPut([
      makeReader({ id: 'r-ready' }),
      makeReader({ id: 'r-generating', status: 'generating' }),
      makeReader({ id: 'r-failed', status: 'failed' }),
      makeReader({ id: 'r-empty', pages: [] }),
    ]);

    const due = await getDueReaders();
    expect(due.map(r => r.id)).toEqual(['r-ready']);
  });

  it('offers only the newest unread story when several are waiting', async () => {
    const old = makeReader({ id: 'r-old', created_at: '2026-01-01T00:00:00Z' });
    const mid = makeReader({ id: 'r-mid', created_at: '2026-06-01T00:00:00Z' });
    const fresh = makeReader({ id: 'r-new', created_at: '2026-07-31T00:00:00Z' });
    await db.readers.bulkPut([old, mid, fresh]);

    const due = await getDueReaders();
    expect(due.map(r => r.id)).toEqual(['r-new']);
  });

  it('offers nothing more once a reader has been read today', async () => {
    const readToday = makeReader({ id: 'r-done' });
    await db.readers.put(readToday);
    await recordReaderReview(readToday.id, 3, 1000); // Easy → review, due in days

    await db.readers.bulkPut([
      makeReader({ id: 'r-unread' }),
      makeReader({ id: 'r-review-due', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 86_400_000).toISOString() }),
    ]);

    expect(await getDueReaders()).toEqual([]);
  });

  it('an Again does not bring the story back the same day', async () => {
    const readToday = makeReader({ id: 'r-again' });
    await db.readers.put(readToday);
    await recordReaderReview(readToday.id, 0, 1000); // Again → tomorrow
    await db.readers.put(makeReader({ id: 'r-unread' }));

    expect(await getDueReaders()).toEqual([]);
  });

  it('picks one of several due readers: the most overdue revisit, then unread; never one done for good', async () => {
    const reviewDue = makeReader({ id: 'r-review-due', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 86_400_000).toISOString() });
    const reviewOverdue = makeReader({ id: 'r-review-overdue', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    const reviewFuture = makeReader({ id: 'r-review-future', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    const retired = makeReader({ id: 'r-retired', queue: CardQueue.REVIEW, retired: true, created_at: '2099-01-01T00:00:00Z' });
    const unread = makeReader({ id: 'r-unread' });
    await db.readers.bulkPut([reviewDue, reviewOverdue, reviewFuture, retired, unread]);

    expect((await getDueReaders()).map(r => r.id)).toEqual(['r-review-overdue']);

    await db.readers.bulkDelete(['r-review-overdue', 'r-review-due']);
    expect((await getDueReaders()).map(r => r.id)).toEqual(['r-unread']);

    await db.readers.delete('r-unread');
    expect(await getDueReaders()).toEqual([]); // only a future review + a retired one left → nothing today
  });
});

describe('pickTodaysReader (pure)', () => {
  const cutoff = { ts: Date.now() + 3_600_000, iso: new Date(Date.now() + 3_600_000).toISOString() };

  it('returns null when there is nothing to read', () => {
    expect(pickTodaysReader([], new Set(), cutoff)).toBeNull();
    const future = makeReader({ id: 'f', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(pickTodaysReader([future], new Set(), cutoff)).toBeNull();
  });

  it('a reader read today blocks every other reader', () => {
    const done = makeReader({ id: 'done', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const unread = makeReader({ id: 'unread' });
    expect(pickTodaysReader([done, unread], new Set(['done']), cutoff)).toBeNull();
  });

  it('a retired NEW reader is never picked', () => {
    expect(pickTodaysReader([makeReader({ id: 'x', retired: true })], new Set(), cutoff)).toBeNull();
  });
});

describe('getReaderIntervalPreviews', () => {
  it('returns the revisit gap for every rating', () => {
    const previews = getReaderIntervalPreviews(makeReader());
    expect([0, 1, 2, 3].map(r => previews[r as 0].intervalText)).toEqual(['1 day', '2 days', '2 wk', '6 wk']);
  });
});

describe('readerTtsKey', () => {
  it('is stable for identical content and changes when content changes', () => {
    const page = { id: 'p1', content_chinese: '你好世界' };
    expect(readerTtsKey(page)).toBe(readerTtsKey({ ...page }));
    expect(readerTtsKey(page)).not.toBe(readerTtsKey({ id: 'p1', content_chinese: '你好' }));
    expect(readerTtsKey(page)).toMatch(/^reader-tts\/p1\//);
  });
});
