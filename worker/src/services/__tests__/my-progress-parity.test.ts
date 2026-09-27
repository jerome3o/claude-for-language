/**
 * The Progress numbers have one definition in shared/progress/daily.ts (the Lab app
 * computes them on the phone and is parity-tested against it). This proves the server's
 * SQL behind GET /api/progress/daily and /api/progress/day/:date — what the web shows —
 * gives exactly the same answer, on real SQLite with every migration.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getMyDailyProgress, getMyDayCards } from '../relationships';
import { dailyProgress, dayCards, utcDate, type ProgressEvent, type ProgressCardInfo } from '../../../../shared/progress';

const USER = 'learner-1';
const OTHER = 'someone-else';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Progress SQL = shared/progress definition', () => {
  let db: SqliteD1;
  const events: ProgressEvent[] = [];
  const cards: ProgressCardInfo[] = [];
  const now = Date.now();

  beforeAll(async () => {
    db = await createSqliteD1();
    exec(db, 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', USER, 'l@example.com', 'L');
    exec(db, 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', OTHER, 'o@example.com', 'O');
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d1', ?, 'HSK 1')", USER);
    const words = [['你好', 'nǐ hǎo', 'hello'], ['谢谢', 'xièxie', 'thanks'], ['猫', 'māo', 'cat'], ['狗', 'gǒu', 'dog']];
    const types = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
    words.forEach(([hanzi, pinyin, english], i) => {
      exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', `n${i}`, 'd1', hanzi, pinyin, english);
      types.forEach((type, j) => {
        const id = `c${i}-${j}`;
        exec(db, 'INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)', id, `n${i}`, type);
        cards.push({ card_id: id, card_type: type, note_id: `n${i}`, hanzi, pinyin, english });
      });
    });

    const rand = rng(42);
    // 40 days of reviews, some days empty, spread over the whole UTC day.
    for (let k = 0; k < 600; k++) {
      const at = now - Math.floor(rand() * 40 * 86_400_000);
      if (rand() < 0.2 && new Date(at).getUTCDay() === 3) continue; // gaps
      const card = cards[Math.floor(rand() * cards.length)];
      const e: ProgressEvent = {
        id: `e${k}`,
        card_id: card.card_id,
        rating: Math.floor(rand() * 4),
        reviewed_at: new Date(at).toISOString(),
        time_spent_ms: rand() < 0.1 ? null : Math.floor(rand() * 20_000),
        user_answer: rand() < 0.3 ? card.hanzi : rand() < 0.5 ? '' : null,
      };
      events.push(e);
      exec(db, 'INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, time_spent_ms, user_answer) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.id, e.card_id, USER, e.rating, e.reviewed_at, e.time_spent_ms ?? null, e.user_answer ?? null);
    }
    // Someone else's reviews never count.
    exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('x1', 'c0-0', ?, 0, ?)", OTHER, new Date(now).toISOString());
  });

  it('daily summary and days', async () => {
    const server = await getMyDailyProgress(db, USER);
    const shared = dailyProgress(events, Date.now());
    expect(shared.days.length).toBeGreaterThan(20);
    expect(shared).toEqual(server);
  });

  it('cards of a day (same rows, same order where the SQL defines one)', async () => {
    const dates = [...new Set(events.map((e) => utcDate(e.reviewed_at)))].slice(0, 12);
    for (const date of dates) {
      const server = await getMyDayCards(db, USER, date);
      const shared = dayCards(events, cards, date);
      expect(shared.summary).toEqual(server.summary);
      const key = (c: { review_count: number; average_rating: number }) => `${c.review_count}:${c.average_rating}`;
      // The SQL leaves ties unordered; the (count, avg) sequence must match exactly.
      expect(shared.cards.map(key)).toEqual(server.cards.map(key));
      const byId = new Map(server.cards.map((c) => [c.card_id, c]));
      for (const c of shared.cards) {
        const s = byId.get(c.card_id)!;
        expect({ ...c, ratings: [...c.ratings].sort() }).toEqual({
          card_id: s.card_id, card_type: s.card_type, note: s.note, review_count: s.review_count,
          ratings: [...s.ratings].sort(), average_rating: s.average_rating, total_time_ms: s.total_time_ms, has_answers: s.has_answers,
        });
      }
    }
  });
});
