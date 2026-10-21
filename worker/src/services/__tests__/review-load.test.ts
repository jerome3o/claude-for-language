/**
 * The tutor's read of "Pause new cards on heavy days" (services/review-load.ts): the SQL
 * form of shared/decks/review-load.ts `reviewLoadToday` against real SQLite with every
 * migration, the student's day in their own zone, and the overview's `review_load`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { fetchReviewLoad, studentReviewLoad, studyDayBounds, tzOffsetMinutesIn } from '../review-load';

const STUDENT = 'student-1';
const H = 3_600_000;
// 21 Oct 2026, 10:00 London (BST, UTC+1) = 09:00Z.
const NOW = new Date('2026-10-21T09:00:00Z');
const DAY_START = Date.parse('2026-10-20T23:00:00Z'); // London midnight
const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
function addCard(db: SqliteD1, opts: { queue: number; next?: number | null; dueTs?: number | null; events?: number[] }): string {
  const id = `c-${++n}`;
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, 'd-1', '银行', 'yínháng', 'bank')", [`n-${id}`]);
  db.raw.run(
    'INSERT INTO cards (id, note_id, card_type, queue, next_review_at, due_timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    [id, `n-${id}`, 'hanzi_to_meaning', opts.queue, opts.next == null ? null : iso(opts.next), opts.dueTs ?? null]
  );
  for (const at of opts.events ?? []) {
    db.raw.run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, ?, ?)', [`e-${id}-${at}`, id, STUDENT, 2, iso(at)]);
  }
  return id;
}

describe('review load on the server', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    n = 0;
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name, role, time_zone) VALUES (?, 's@x.test', 'Jerome', 'student', 'Europe/London')", [STUDENT]);
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-1', ?, 'Deck')", [STUDENT]);
  });

  it('the zone and the day', () => {
    expect(tzOffsetMinutesIn('Europe/London', NOW)).toBe(-60);
    expect(tzOffsetMinutesIn('Asia/Shanghai', NOW)).toBe(-480);
    expect(tzOffsetMinutesIn('UTC', NOW)).toBe(0);
    expect(tzOffsetMinutesIn('Not/AZone', NOW)).toBeNull();
    expect(tzOffsetMinutesIn(null, NOW)).toBeNull();
    const b = studyDayBounds(NOW.getTime(), -60);
    expect(b.dayStartMs).toBe(DAY_START);
    expect(b.cutoffMs).toBe(DAY_START + 24 * H - 1);
    // Near midnight the cutoff is now + 1 hour.
    expect(studyDayBounds(DAY_START + 23.5 * H, -60).cutoffMs).toBe(DAY_START + 24.5 * H);
  });

  it('counts due + reviewed today, never NEW or introduced today, stable as cards are done', async () => {
    const before = DAY_START - 10 * 24 * H;
    addCard(db, { queue: 2, next: DAY_START + 3 * H, events: [before] }); // due later today
    addCard(db, { queue: 2, next: DAY_START - 2 * 24 * H, events: [before] }); // overdue
    addCard(db, { queue: 2, next: DAY_START + 2 * 24 * H, events: [before] }); // not due
    addCard(db, { queue: 2, next: DAY_START + 7 * 24 * H, events: [before, DAY_START + H] }); // was due, done today
    addCard(db, { queue: 3, dueTs: DAY_START + 9 * H, events: [before, DAY_START + 2 * H] }); // Again today
    addCard(db, { queue: 1, dueTs: DAY_START + 9 * H, events: [DAY_START + 2 * H] }); // introduced today
    addCard(db, { queue: 2, next: DAY_START + 3 * 24 * H, events: [DAY_START + H] }); // introduced today, graduated
    addCard(db, { queue: 0 }); // new
    const { cutoffMs } = studyDayBounds(NOW.getTime(), -60);
    expect(await fetchReviewLoad(db, STUDENT, DAY_START, cutoffMs)).toBe(4);
    // Another user's events never count.
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('other', 'o@x.test', 'O')");
    expect(await fetchReviewLoad(db, 'other', DAY_START, cutoffMs)).toBe(0);
  });

  it('the state against the limit; null when the limit is off', async () => {
    for (let i = 0; i < 12; i++) addCard(db, { queue: 2, next: DAY_START - H, events: [DAY_START - 5 * 24 * H] });
    expect(await studentReviewLoad(db, { id: STUDENT, pause_new_when_reviews_over: null, time_zone: 'Europe/London' }, 0, NOW)).toBeNull();
    expect(await studentReviewLoad(db, { id: STUDENT, pause_new_when_reviews_over: 10, time_zone: 'Europe/London' }, 0, NOW)).toEqual({ load: 12, threshold: 10, paused: true });
    expect(await studentReviewLoad(db, { id: STUDENT, pause_new_when_reviews_over: 12, time_zone: null }, -60, NOW)).toEqual({ load: 12, threshold: 12, paused: false });
  });
});
