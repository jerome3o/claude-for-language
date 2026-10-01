/**
 * The tutor's "Characters / Words known" (getKnownCounts: one SQL query over the cached card
 * state) must give the same answer as the student's own Progress page (knownProgress: a
 * replay of every review event) when the card rows are the replay of their events — on real
 * SQLite with every migration.
 */
import { describe, it, expect } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getKnownCounts } from '../known-counts';
import { knownProgress, type KnownEventInput } from '../../../../shared/progress/known';
import { computeCardState, type ReviewEvent } from '../../../../shared/scheduler';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANZI = ['你好', '好吃', '吃饭', '我很好。', '咖啡', '黑咖啡', '一两年以后', 'T恤衫', '你好', '猫', 'OK', '今天天气很好！'];

describe('getKnownCounts = knownProgress headline', () => {
  it('matches on generated histories, and ignores other users', async () => {
    const db = await createSqliteD1();
    exec(db, "INSERT INTO users (id, email, name) VALUES ('u1', 'a@example.com', 'A'), ('u2', 'b@example.com', 'B')");
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'Mine'), ('d2', 'u2', 'Theirs')");
    const r = rng(11);
    const notes: { id: string; hanzi: string }[] = [];
    const cards: { id: string; note_id: string }[] = [];
    const events: KnownEventInput[] = [];
    const t0 = Date.parse('2026-01-05T08:00:00.000Z');
    HANZI.forEach((hanzi, i) => {
      const id = `n${i}`;
      notes.push({ id, hanzi });
      exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', id, 'd1', hanzi, '', '');
      for (let k = 0; k < 3; k++) {
        const cid = `${id}c${k}`;
        cards.push({ id: cid, note_id: id });
        const own: ReviewEvent[] = [];
        let at = t0 + Math.floor(r() * 30) * 86_400_000;
        const n = Math.floor(r() * 6);
        for (let e = 0; e < n; e++) {
          own.push({ id: `${cid}e${e}`, card_id: cid, rating: (r() < 0.15 ? 0 : r() < 0.5 ? 3 : 2) as 0 | 2 | 3, reviewed_at: new Date(at).toISOString() });
          at += Math.floor(1 + r() * 25) * 86_400_000;
        }
        events.push(...own);
        const s = computeCardState(own);
        exec(db, 'INSERT INTO cards (id, note_id, card_type, queue, stability) VALUES (?, ?, ?, ?, ?)',
          cid, id, ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'][k], s.queue, s.stability);
      }
    });
    // Someone else's mature note must not count.
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('x', 'd2', '鳄鱼', '', '')");
    exec(db, "INSERT INTO cards (id, note_id, card_type, queue, stability) VALUES ('xc', 'x', 'hanzi_to_meaning', 2, 90)");

    const expected = knownProgress(notes, cards, events);
    expect(expected.characters.known).toBeGreaterThan(0);
    expect(expected.characters.learning).toBeGreaterThan(0);
    expect(expected.words.known).toBeGreaterThan(0);
    expect(await getKnownCounts(db as unknown as D1Database, 'u1')).toEqual({
      characters: expected.characters,
      words: expected.words,
      sentences: expected.sentences,
    });
  });
});
