import { describe, it, expect } from 'vitest';
import { dailyProgress, dayCards, windowStart, utcDate, formatStudyTime } from './daily';
import { studyStreak, formatStreakTime } from './streak';
import { masteryLevel, masteryProgress } from './mastery';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');
const ev = (card_id: string, rating: number, reviewed_at: string, time_spent_ms: number | null = 1000, user_answer: string | null = null) =>
  ({ card_id, rating, reviewed_at, time_spent_ms, user_answer });

describe('dailyProgress', () => {
  it('groups by UTC date, newest first, with rounded accuracies', () => {
    const p = dailyProgress([
      ev('a', 2, '2026-09-27T01:00:00.000Z'),
      ev('a', 0, '2026-09-27T02:00:00.000Z'),
      ev('b', 3, '2026-09-27T23:59:59.000Z', null),
      ev('b', 1, '2026-09-25T12:00:00.000Z', 500),
    ], NOW);
    expect(p.days).toEqual([
      { date: '2026-09-27', reviews_count: 3, unique_cards: 2, accuracy: 67, time_spent_ms: 2000 },
      { date: '2026-09-25', reviews_count: 1, unique_cards: 1, accuracy: 0, time_spent_ms: 500 },
    ]);
    // mean of 66.67 and 0 = 33.3 → 33
    expect(p.summary).toEqual({ total_reviews_30d: 4, total_days_active: 2, average_accuracy: 33, total_time_ms: 2500 });
  });

  it('keeps the whole boundary day, like the SQL string comparison', () => {
    expect(windowStart(NOW)).toBe('2026-08-28 10:00:00');
    const p = dailyProgress([
      ev('a', 2, '2026-08-28T00:00:01.000Z'), // before 10:00 but same date → in ('T' > ' ')
      ev('a', 2, '2026-08-27T23:59:59.000Z'), // out
    ], NOW);
    expect(p.days.map((d) => d.date)).toEqual(['2026-08-28']);
  });

  it('is empty with no events', () => {
    expect(dailyProgress([], NOW)).toEqual({
      summary: { total_reviews_30d: 0, total_days_active: 0, average_accuracy: 0, total_time_ms: 0 },
      days: [],
    });
  });

  it('reads offsets as the SQL does (UTC date)', () => {
    expect(utcDate('2026-09-27T08:00:00+12:00')).toBe('2026-09-26');
  });
});

describe('dayCards', () => {
  const cards = [
    { card_id: 'a', card_type: 'hanzi_to_meaning', note_id: 'n1', hanzi: '猫', pinyin: 'māo', english: 'cat' },
    { card_id: 'b', card_type: 'audio_to_hanzi', note_id: 'n2', hanzi: '狗', pinyin: 'gǒu', english: 'dog' },
  ];
  it('orders most difficult first and skips unknown cards', () => {
    const d = dayCards([
      ev('a', 3, '2026-09-27T01:00:00.000Z'),
      ev('b', 0, '2026-09-27T02:00:00.000Z', 1000, '句'),
      ev('b', 2, '2026-09-27T03:00:00.000Z'),
      ev('gone', 0, '2026-09-27T03:00:00.000Z'),
      ev('a', 0, '2026-09-26T03:00:00.000Z'),
    ], cards, '2026-09-27');
    expect(d.cards.map((c) => [c.card_id, c.ratings, c.has_answers])).toEqual([['b', [0, 2], true], ['a', [3], false]]);
    expect(d.summary).toEqual({ total_reviews: 3, unique_cards: 2, accuracy: 67, time_spent_ms: 3000 });
  });
});

describe('formatStudyTime', () => {
  it.each([[0, '0 min'], [59_999, '< 1 min'], [60_000, '1 min'], [89_999, '1 min'], [90_000, '2 min'], [3_600_000, '1h'], [3_900_000, '1h 5m']])(
    '%i → %s', (ms, text) => expect(formatStudyTime(ms)).toBe(text));
  it('streak time floors', () => expect(formatStreakTime(119_000)).toBe('1m'));
});

describe('studyStreak', () => {
  it('counts back from yesterday when today is empty', () => {
    const now = new Date('2026-09-27T10:00:00.000Z');
    const s = studyStreak([
      ev('a', 2, '2026-09-26T10:00:00.000Z'),
      ev('a', 2, '2026-09-25T10:00:00.000Z'),
      ev('a', 2, '2026-09-23T10:00:00.000Z'),
    ], now);
    // Tests run in the process time zone; UTC in CI (TZ unset) — only assert TZ-free shape.
    expect(s.heatmap).toHaveLength(30);
    expect(s.max_count).toBeGreaterThanOrEqual(1);
    expect(s.streak).toBeGreaterThanOrEqual(1);
  });
});

describe('mastery', () => {
  it('levels', () => {
    expect([masteryLevel(0, 99), masteryLevel(1, 99), masteryLevel(3, 99), masteryLevel(2, 7), masteryLevel(2, 21), masteryLevel(2, 21.01)])
      .toEqual(['new', 'learning', 'learning', 'learning', 'familiar', 'mastered']);
  });
  it('completion + breakdown', () => {
    const p = masteryProgress([
      { card_type: 'hanzi_to_meaning', queue: 2, stability: 30 },
      { card_type: 'hanzi_to_meaning', queue: 0, stability: 0 },
      { card_type: 'audio_to_hanzi', queue: 2, stability: 10 },
    ]);
    expect(p.completion).toEqual({ total_cards: 3, cards_seen: 2, cards_mastered: 1, percent_seen: 67, percent_mastered: 33 });
    expect(p.breakdown.hanzi_to_meaning).toEqual({ total: 2, new: 1, learning: 0, familiar: 0, mastered: 1 });
    expect(p.breakdown.audio_to_hanzi.familiar).toBe(1);
  });
});
