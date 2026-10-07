import { describe, expect, it } from 'vitest';
import {
  READERS_PER_DAY,
  STORY_PAGE_GAP_MS,
  nextUnreadReader,
  pickTodaysReader,
  shouldGenerateDailyReader,
  storyNextPage,
  storyPageGapMs,
  type ReaderOfferRow,
} from './daily-reader';

const row = (id: string, created_at: string, over: Partial<ReaderOfferRow> = {}): ReaderOfferRow => ({
  id, created_at, studyable: true, read: false, ...over,
});

describe('graded readers are read once', () => {
  it('one a day', () => expect(READERS_PER_DAY).toBe(1));

  it('never offers a reader that was already read', () => {
    const readers = [row('a', '2026-10-02', { read: true }), row('b', '2026-09-01', { read: true })];
    expect(pickTodaysReader(readers, false)).toBeNull();
    expect(nextUnreadReader(readers)).toBeNull();
  });

  it('offers the newest unread, studyable story', () => {
    const readers = [
      row('old', '2026-09-25'),
      row('new', '2026-10-02'),
      row('gen', '2026-10-05', { studyable: false }),
      row('read', '2026-10-06', { read: true }),
    ];
    expect(pickTodaysReader(readers, false)?.id).toBe('new');
  });

  it('keeps offering the same unread daily reader day after day', () => {
    const readers = [row('daily', '2026-10-02'), row('older', '2026-09-01', { read: true })];
    for (let day = 0; day < 3; day++) expect(pickTodaysReader(readers, false)?.id).toBe('daily');
  });

  it('nothing more once a story was read today', () => {
    expect(pickTodaysReader([row('a', '2026-10-02')], true)).toBeNull();
    // …but the next one is known (its narration is prefetched for tomorrow).
    expect(nextUnreadReader([row('a', '2026-10-02')])?.id).toBe('a');
  });

  it('ties on created_at go by id', () => {
    expect(pickTodaysReader([row('b', '2026-10-02'), row('a', '2026-10-02')], false)?.id).toBe('a');
  });
});

describe('shouldGenerateDailyReader', () => {
  const base = { readToday: false, hasUnread: false, lastAttemptDate: null as string | null, today: '2026-10-07' };
  it('generates only when nothing is unread, nothing was read today, and it was not tried today', () => {
    expect(shouldGenerateDailyReader(base)).toBe(true);
    expect(shouldGenerateDailyReader({ ...base, hasUnread: true })).toBe(false);
    expect(shouldGenerateDailyReader({ ...base, readToday: true })).toBe(false);
    expect(shouldGenerateDailyReader({ ...base, lastAttemptDate: '2026-10-07' })).toBe(false);
    expect(shouldGenerateDailyReader({ ...base, lastAttemptDate: '2026-10-06' })).toBe(true);
  });
});

describe('Play whole story', () => {
  it('turns page after page, then finishes', () => {
    expect(storyNextPage(0, 3)).toBe(1);
    expect(storyNextPage(1, 3)).toBe(2);
    expect(storyNextPage(2, 3)).toBeNull();
    expect(storyNextPage(0, 1)).toBeNull();
    expect(storyNextPage(0, 0)).toBeNull();
  });
  it('the beat between pages stretches at slower speeds', () => {
    expect(storyPageGapMs(1)).toBe(STORY_PAGE_GAP_MS);
    expect(storyPageGapMs(0.5)).toBe(STORY_PAGE_GAP_MS * 2);
    expect(storyPageGapMs(0.75)).toBe(800);
    expect(storyPageGapMs(2)).toBe(STORY_PAGE_GAP_MS);
  });
});
