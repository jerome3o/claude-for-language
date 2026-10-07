import { describe, it, expect } from 'vitest';
import {
  getDueReaders,
  recordReaderFinish,
  fixReaderState,
  isStudyableReader,
  READERS_PER_DAY,
  pickTodaysReader,
  readerRotationState,
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

describe('recordReaderFinish', () => {
  it('creates an unsynced event and marks the story read — never due again', async () => {
    const reader = makeReader();
    await db.readers.put(reader);

    const { event } = await recordReaderFinish(reader.id, 30_000);

    expect(event.reader_id).toBe(reader.id);
    expect(event._synced).toBe(0);
    expect(event.rating).toBe(2);

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.REVIEW);
    expect(stored?.repetitions).toBe(1);
    expect(stored?.due_timestamp).toBeNull();
    expect(stored?.next_review_at).toBeNull();
    expect(await db.readerReviewEvents.count()).toBe(1);
  });
});

describe('fixReaderState', () => {
  it('repairs a drifted cached state from events (old revisit fields are cleared)', async () => {
    const reader = makeReader();
    await db.readers.put(reader);
    await recordReaderFinish(reader.id, 1000);

    // Corrupt the cached state the way the old "revisit later" rows looked
    await db.readers.update(reader.id, { queue: CardQueue.NEW, repetitions: 0, retired: true, due_timestamp: 123 });

    const computed = await fixReaderState(reader.id);
    expect(computed.queue).toBe(CardQueue.REVIEW);

    const stored = await db.readers.get(reader.id);
    expect(stored?.queue).toBe(CardQueue.REVIEW);
    expect(stored?.repetitions).toBe(1);
    expect(stored?.retired).toBe(false);
    expect(stored?.due_timestamp).toBeNull();
  });
});

describe('getDueReaders — one unread reader a day, never a repeat', () => {
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
    await recordReaderFinish(readToday.id, 1000);
    await db.readers.put(makeReader({ id: 'r-unread', created_at: '2020-01-01T00:00:00Z' }));

    expect(await getDueReaders()).toEqual([]);
    // …the next unread one is known for tomorrow (its narration is prefetched)
    expect((await readerRotationState()).next?.id).toBe('r-unread');
  });

  it('never offers a story that was already read, whatever its old schedule said', async () => {
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await db.readers.put(makeReader({ id: 'r-read', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 86_400_000).toISOString() }));
    await db.readerReviewEvents.put({ id: 'e1', reader_id: 'r-read', rating: 0, time_spent_ms: 1, reviewed_at: yesterday, _synced: 1, _created_at: yesterday });
    expect(await getDueReaders()).toEqual([]);
  });
});

describe('pickTodaysReader (pure)', () => {
  it('returns null when there is nothing unread', () => {
    expect(pickTodaysReader([], new Set())).toBeNull();
    expect(pickTodaysReader([makeReader({ id: 'f', queue: CardQueue.REVIEW })], new Set())).toBeNull();
  });

  it('a reader read today blocks every other reader', () => {
    const done = makeReader({ id: 'done', queue: CardQueue.REVIEW });
    const unread = makeReader({ id: 'unread' });
    expect(pickTodaysReader([done, unread], new Set(['done']))).toBeNull();
    expect(pickTodaysReader([done, unread], new Set())?.id).toBe('unread');
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
