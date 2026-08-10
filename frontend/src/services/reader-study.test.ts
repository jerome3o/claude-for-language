import { describe, it, expect } from 'vitest';
import {
  getDueReaders,
  recordReaderReview,
  fixReaderState,
  isStudyableReader,
  getReaderIntervalPreviews,
  NEW_READERS_PER_DAY,
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
  it('creates an unsynced event and advances FSRS state', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    const { event, newState } = await recordReaderReview(reader.id, 2, 30_000);

    expect(event.reader_id).toBe(reader.id);
    expect(event._synced).toBe(0);
    expect(newState.queue).toBe(CardQueue.LEARNING); // Good on NEW → learning

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.LEARNING);
    expect(stored?.due_timestamp).toBeGreaterThan(Date.now());

    const events = await db.readerReviewEvents.toArray();
    expect(events).toHaveLength(1);
  });

  it('Easy on a new reader graduates it straight to review', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    const { newState } = await recordReaderReview(reader.id, 3, 30_000);

    expect(newState.queue).toBe(CardQueue.REVIEW);
    expect(newState.next_review_at).not.toBeNull();
  });

  it('state is derived from the full event history', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    await recordReaderReview(reader.id, 2, 1000);
    await recordReaderReview(reader.id, 2, 1000);
    const { newState } = await recordReaderReview(reader.id, 2, 1000);

    expect(newState.reps).toBe(3);
    expect(await db.readerReviewEvents.count()).toBe(3);
  });
});

describe('fixReaderState', () => {
  it('repairs a drifted cached state from events', async () => {
    const reader = makeReader();
    await db.readers.put(reader);
    await recordReaderReview(reader.id, 3, 1000); // → REVIEW

    // Corrupt the cached state
    await db.readers.update(reader.id, { queue: CardQueue.NEW, repetitions: 0 });

    const computed = await fixReaderState(reader.id);
    expect(computed.queue).toBe(CardQueue.REVIEW);

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.REVIEW);
    expect(stored?.repetitions).toBe(1);
  });
});

describe('getDueReaders', () => {
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

  it('caps NEW readers at NEW_READERS_PER_DAY, newest first', async () => {
    const old = makeReader({ id: 'r-old', created_at: '2026-01-01T00:00:00Z' });
    const mid = makeReader({ id: 'r-mid', created_at: '2026-06-01T00:00:00Z' });
    const fresh = makeReader({ id: 'r-new', created_at: '2026-07-31T00:00:00Z' });
    await db.readers.bulkPut([old, mid, fresh]);

    const due = await getDueReaders();
    expect(due).toHaveLength(NEW_READERS_PER_DAY);
    expect(due.map(r => r.id)).toEqual(['r-new', 'r-mid'].slice(0, NEW_READERS_PER_DAY));
  });

  it('counts readers introduced today against the NEW budget', async () => {
    const introduced = makeReader({ id: 'r-done' });
    await db.readers.put(introduced);
    await recordReaderReview(introduced.id, 3, 1000); // introduced today, now REVIEW (future due)

    await db.readers.bulkPut([makeReader({ id: 'r-a' }), makeReader({ id: 'r-b' })]);

    const due = await getDueReaders();
    // Budget of NEW_READERS_PER_DAY minus the one introduced today
    const newOnes = due.filter(r => r.queue === CardQueue.NEW);
    expect(newOnes).toHaveLength(NEW_READERS_PER_DAY - 1);
  });

  it('includes learning readers due today and review readers due now', async () => {
    const learning = makeReader({
      id: 'r-learning',
      queue: CardQueue.LEARNING,
      due_timestamp: Date.now() - 1000,
    });
    const reviewDue = makeReader({
      id: 'r-review-due',
      queue: CardQueue.REVIEW,
      next_review_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const reviewFuture = makeReader({
      id: 'r-review-future',
      queue: CardQueue.REVIEW,
      next_review_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    await db.readers.bulkPut([learning, reviewDue, reviewFuture]);

    const due = await getDueReaders();
    expect(due.map(r => r.id).sort()).toEqual(['r-learning', 'r-review-due']);
  });
});

describe('getReaderIntervalPreviews', () => {
  it('returns a preview for every rating', () => {
    const previews = getReaderIntervalPreviews(makeReader());
    for (const rating of [0, 1, 2, 3] as const) {
      expect(previews[rating].intervalText).toBeTruthy();
    }
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
