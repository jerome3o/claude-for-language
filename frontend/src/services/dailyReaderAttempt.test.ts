import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../api/client';
import { db, LocalReader } from '../db/database';
import { recordReaderReview } from './reader-study';
import { CardQueue } from '../types';
import {
  ensureDailyReader,
  shouldAttemptDailyReader,
  getDailyReaderAttemptDate,
  recordDailyReaderAttempt,
  clearDailyReaderAttempt,
} from './readerSync';

describe('shouldAttemptDailyReader (pure)', () => {
  it('allows the first attempt of the day', () => {
    expect(shouldAttemptDailyReader(null, '2026-09-18')).toBe(true);
    expect(shouldAttemptDailyReader('2026-09-17', '2026-09-18')).toBe(true);
  });

  it('blocks a second attempt on the same local date', () => {
    expect(shouldAttemptDailyReader('2026-09-18', '2026-09-18')).toBe(false);
  });
});

describe('attempt date storage', () => {
  beforeEach(() => clearDailyReaderAttempt());

  it('round-trips through localStorage', () => {
    expect(getDailyReaderAttemptDate()).toBeNull();
    recordDailyReaderAttempt('2026-09-18');
    expect(getDailyReaderAttemptDate()).toBe('2026-09-18');
    clearDailyReaderAttempt();
    expect(getDailyReaderAttemptDate()).toBeNull();
  });
});

function readyReader(overrides: Partial<LocalReader> = {}): LocalReader {
  const id = overrides.id ?? `reader-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title_chinese: '小明在巴黎',
    title_english: 'Xiao Ming in Paris',
    difficulty_level: 'beginner',
    status: 'ready',
    created_at: new Date().toISOString(),
    pages: [{ id: `${id}-p1`, page_number: 1, content_chinese: '小明到了巴黎。', content_pinyin: 'xiǎo míng dào le bā lí.', content_english: 'Xiao Ming arrived in Paris.', image_url: null, image_prompt: null }],
    queue: CardQueue.NEW, stability: 0, difficulty: 0, lapses: 0, interval: 0, repetitions: 0,
    next_review_at: null, due_timestamp: null, last_reviewed_at: null, _synced_at: null,
    ...overrides,
  };
}

describe('ensureDailyReader — one reader a day', () => {
  beforeEach(async () => {
    clearDailyReaderAttempt();
    await db.readers.clear();
    await db.readerReviewEvents.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('does not generate while an unread story is waiting', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader');
    await db.readers.put(readyReader({ id: 'unread' }));
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).not.toHaveBeenCalled();
  });

  it('does not generate when a review reader is due today — that one is the day\'s reader', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader');
    await db.readers.put(readyReader({ id: 'due', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() - 86_400_000).toISOString() }));
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).not.toHaveBeenCalled();
  });

  it('does not generate once a reader has been read today', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader');
    await db.readers.put(readyReader({ id: 'done' }));
    await recordReaderReview('done', 3, 1000);
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).not.toHaveBeenCalled();
  });

  it('generates when nothing is due today', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader').mockResolvedValue({ reader_id: 'r1', situation_id: 'due-cards', status: 'generating' });
    await db.readers.put(readyReader({ id: 'future', queue: CardQueue.REVIEW, next_review_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
    expect(await ensureDailyReader()).toBe(true);
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

describe('ensureDailyReader — one attempt per local date', () => {
  beforeEach(async () => {
    clearDailyReaderAttempt();
    await db.readers.clear();
    await db.readerReviewEvents.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('asks the server once, then skips for the rest of the day even after a failure', async () => {
    // A failed daily reader: the server answers 'failed' and, before the
    // guard, would have been asked again at every session end.
    const gen = vi.spyOn(client, 'generateDailyReader').mockResolvedValue({
      reader_id: 'r1',
      situation_id: 'due-cards',
      status: 'failed',
      error_message: 'Could not resolve authentication method.',
    });

    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(getDailyReaderAttemptDate()).toBe(client.getLocalDateString());

    expect(await ensureDailyReader()).toBe(false);
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('asks again on a new local date', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader').mockResolvedValue({
      reader_id: 'r1',
      situation_id: 'due-cards',
      status: 'generating',
    });
    recordDailyReaderAttempt('2000-01-01'); // "yesterday"

    expect(await ensureDailyReader()).toBe(true);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('records the attempt even when the request throws, so a flaky API is not hammered', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader').mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await ensureDailyReader()).toBe(false);
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('does not count an offline call as an attempt', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const gen = vi.spyOn(client, 'generateDailyReader');

    expect(await ensureDailyReader()).toBe(false);
    expect(gen).not.toHaveBeenCalled();
    expect(getDailyReaderAttemptDate()).toBeNull();
  });
});
