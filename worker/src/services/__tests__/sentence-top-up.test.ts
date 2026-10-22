/**
 * Listening cards' sentence top-up (shared/study/listenContext.ts) against real SQLite with
 * every migration: which notes may be topped up (fewer than five in total — the card's own
 * sentence counted unless the set repeats it —, the caller's own, at most one job a day,
 * never one given up on) and appending rows that keeps the set's rows (ids, clips) and
 * touches them all, so `/api/sentences/changes` still hands the set out whole.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { appendNoteSentences, getNotesForSentenceTopUp } from '../../db/queries';

let db: SqliteD1;

function addNote(id: string, user: string, clue: string | null, sentences: string[]) {
  db.raw.run('INSERT OR IGNORE INTO decks (id, user_id, name) VALUES (?, ?, ?)', [`d-${user}`, user, 'Deck']);
  db.raw.run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english, sentence_clue) VALUES (?, ?, ?, ?, ?, ?)', [id, `d-${user}`, '银行', 'yínháng', 'bank', clue]);
  sentences.forEach((hanzi, i) => {
    db.raw.run(
      `INSERT INTO note_sentences (id, note_id, position, hanzi, pinyin, translation, audio_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [`${id}-s${i}`, id, i, hanzi, `generated/${id}-${i}.mp3`],
    );
  });
}

beforeEach(async () => {
  db = await createSqliteD1();
  for (const u of ['u1', 'u2']) db.raw.run('INSERT INTO users (id, email, name, role, is_admin) VALUES (?, ?, ?, ?, 0)', [u, `${u}@example.com`, u, 'student']);
});

describe('getNotesForSentenceTopUp', () => {
  it('picks the caller\'s notes with fewer than five sentences in total', async () => {
    addNote('few', 'u1', '这是银行。', ['我去银行。', '银行在哪儿？']); // 3
    addNote('repeat', 'u1', '我去银行。', ['我去银行。', 'a', 'b', 'c']); // clue repeated → 4
    addNote('enough', 'u1', '这是银行。', ['a', 'b', 'c', 'd']); // 5
    addNote('bare', 'u1', null, []); // 0
    addNote('theirs', 'u2', null, []);
    const got = await getNotesForSentenceTopUp(db, 'u1', ['few', 'repeat', 'enough', 'bare', 'theirs'], 5);
    expect(Object.fromEntries(got.map((r) => [r.id, r.total]))).toEqual({ few: 3, repeat: 4, bare: 0 });
  });

  it('skips a note with a job in the last day or one given up on', async () => {
    addNote('recent', 'u1', null, []);
    addNote('old', 'u1', null, []);
    addNote('failed', 'u1', null, []);
    db.raw.run("INSERT INTO note_sentence_jobs (note_id, status, attempts, updated_at) VALUES ('recent', 'done', 1, datetime('now', '-2 hours'))");
    db.raw.run("INSERT INTO note_sentence_jobs (note_id, status, attempts, updated_at) VALUES ('old', 'done', 1, datetime('now', '-3 days'))");
    db.raw.run("INSERT INTO note_sentence_jobs (note_id, status, attempts, updated_at) VALUES ('failed', 'error', 3, datetime('now', '-3 days'))");
    const got = await getNotesForSentenceTopUp(db, 'u1', ['recent', 'old', 'failed'], 5);
    expect(got.map((r) => r.id)).toEqual(['old']);
  });
});

describe('appendNoteSentences', () => {
  it('adds after the set, keeping its rows and touching them all', async () => {
    addNote('n', 'u1', null, ['我去银行。', '银行在哪儿？']);
    const rows = await appendNoteSentences(db, 'n', [
      { hanzi: '银行几点开门？', pinyin: 'yínháng jǐ diǎn kāimén?', translation: 'When does the bank open?', audioUrl: null, focus: 'core', focusNote: null },
    ]);
    expect(rows.map((r) => [r.id, r.position, r.hanzi])).toEqual([
      ['n-s0', 0, '我去银行。'],
      ['n-s1', 1, '银行在哪儿？'],
      [rows[2].id, 2, '银行几点开门？'],
    ]);
    expect(rows[0].audio_url).toBe('generated/n-0.mp3');
    const stamps = new Set(rows.map((r) => r.updated_at));
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).not.toBe('2026-01-01T00:00:00Z');
  });
});
