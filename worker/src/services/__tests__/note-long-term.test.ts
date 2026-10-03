/**
 * "Add to my long-term review" (migration 0095, docs/HOMEWORK.md §3a): the learner's per-word
 * choice is stored on their own note without touching updated_at, and still reaches every
 * device through /api/sync/changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as content from '../content';
import { getNotesChangedSince, insertNoteCopy } from '../../db/queries';

const STUDENT = 'u-student';
const OTHER = 'u-other';

function exec(db: SqliteD1, sql: string, ...params: Array<string | number | null>) {
  db.raw.run(sql, params);
}

describe('notes.long_term', () => {
  let db: SqliteD1;
  const env = () => ({ DB: db }) as any;

  beforeEach(async () => {
    db = await createSqliteD1();
    exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 's@example.com', 'S', 'student')", STUDENT);
    exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 'o@example.com', 'O', 'student')", OTHER);
    exec(db, "INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day) VALUES ('d-oneoff', ?, 'Lesson 8', 0, 0)", STUDENT);
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d-other', ?, 'Theirs')", OTHER);
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, updated_at) VALUES ('n1', 'd-oneoff', '刮风', 'guā fēng', 'windy', '2026-09-01 10:00:00')");
    exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n-other', 'd-other', '下雨', 'xià yǔ', 'rain')");
  });

  it('a new column starts NULL (follow the deck)', () => {
    expect(db.rows('SELECT long_term, long_term_at FROM notes WHERE id = ?', ['n1'])).toEqual([{ long_term: null, long_term_at: null }]);
  });

  it('stores 1 / 0 / null from true / false / null, leaves updated_at alone, and is idempotent', async () => {
    const on = await content.setNoteLongTerm(env(), STUDENT, 'n1', true);
    expect(on).toMatchObject({ id: 'n1', long_term: 1 });
    expect(await content.setNoteLongTerm(env(), STUDENT, 'n1', 1)).toMatchObject({ long_term: 1 });
    expect(await content.setNoteLongTerm(env(), STUDENT, 'n1', false)).toMatchObject({ long_term: 0 });
    expect(await content.setNoteLongTerm(env(), STUDENT, 'n1', null)).toMatchObject({ long_term: null });
    const [row] = db.rows<{ updated_at: string; long_term_at: string | null }>('SELECT updated_at, long_term_at FROM notes WHERE id = ?', ['n1']);
    expect(row.updated_at).toBe('2026-09-01 10:00:00');
    expect(row.long_term_at).toBeTruthy();
  });

  it("refuses another user's note and values that are not a choice", async () => {
    expect(await content.setNoteLongTerm(env(), STUDENT, 'n-other', true)).toBeNull();
    expect(db.rows('SELECT long_term FROM notes WHERE id = ?', ['n-other'])).toEqual([{ long_term: null }]);
    await expect(content.setNoteLongTerm(env(), STUDENT, 'n1', 'yes')).rejects.toMatchObject({ status: 400 });
    await expect(content.setNoteLongTerm(env(), STUDENT, 'n1', 2)).rejects.toMatchObject({ status: 400 });
  });

  it('a choice reaches other devices through the changes feed', async () => {
    const before = await getNotesChangedSince(db, STUDENT, '2026-09-02 00:00:00');
    expect(before.results).toHaveLength(0);
    await content.setNoteLongTerm(env(), STUDENT, 'n1', true);
    const after = await getNotesChangedSince(db, STUDENT, '2026-09-02 00:00:00');
    expect(after.results.map(n => [n.id, n.long_term])).toEqual([['n1', 1]]);
  });

  it("a copy (share / update a student's copy) never carries the choice", async () => {
    await content.setNoteLongTerm(env(), STUDENT, 'n1', false);
    const [source] = db.rows<Record<string, unknown>>('SELECT * FROM notes WHERE id = ?', ['n1']);
    const copyId = await insertNoteCopy(db, 'd-other', source);
    expect(db.rows('SELECT long_term FROM notes WHERE id = ?', [copyId])).toEqual([{ long_term: null }]);
  });
});
