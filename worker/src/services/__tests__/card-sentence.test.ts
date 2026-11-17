/**
 * The card's own example sentence as a note_sentences row (migration 0154, db/card-sentence.ts,
 * shared/study/cardSentence.ts) against real SQLite with every migration:
 * - the migration backfills one row per note with a card sentence (clip key reused, never regenerated),
 *   merges a set row repeating it, leaves notes without one alone, and is idempotent;
 * - an old client / MCP write to sentence_clue* lands in the row (create, edit, clear);
 * - a tutor's edit carried to the student's copy moves the copy's row too, the shared clip key kept;
 * - regenerating / deleting the set never touches the card row; top-ups append after it;
 * - /api/sentences/changes hands whole notes out, a removed card sentence included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrationsFrom, createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/queries';
import { reconcileCardSentencesForUser, syncCardSentences, noteIdOfCardSentence } from '../../db/card-sentence';
import { updateSharedDeckCopy } from '../relationships';

const MIGRATION = '0154_card_sentence_rows.sql';
const D1 = (db: SqliteD1) => db as unknown as D1Database;

function seedUsers(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('stu', 's@x.test', 'Student', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('tut', 't@x.test', 'Tutor', 'tutor')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-stu', 'stu', 'Mine')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-tut', 'tut', 'Homework')");
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d-copy', 'stu', 'Homework (from tutor)')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tut', 'stu', 'tutor', 'active')");
  db.raw.run("INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share', 'rel', 'd-tut', 'd-copy')");
}

function note(db: SqliteD1, id: string, deck: string, hanzi: string, clue: string | null, extra: Record<string, string | null> = {}) {
  const cols = ['id', 'deck_id', 'hanzi', 'pinyin', 'english', 'sentence_clue', ...Object.keys(extra)];
  const vals = [id, deck, hanzi, 'x', 'x', clue, ...Object.values(extra)];
  db.raw.run(`INSERT INTO notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
}

function setRow(db: SqliteD1, id: string, noteId: string, position: number, hanzi: string, extra: Record<string, string | null> = {}) {
  const cols = ['id', 'note_id', 'position', 'hanzi', 'updated_at', ...Object.keys(extra)];
  const vals = [id, noteId, position, hanzi, '2026-10-01T00:00:00.000Z', ...Object.values(extra)];
  db.raw.run(`INSERT INTO note_sentences (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
}

const rowsOf = (db: SqliteD1, noteId: string) =>
  db.rows<{ id: string; position: number; hanzi: string; pinyin: string | null; translation: string | null; audio_url: string | null; explanation: string | null; is_card: number }>(
    'SELECT id, position, hanzi, pinyin, translation, audio_url, explanation, is_card FROM note_sentences WHERE note_id = ? ORDER BY position',
    [noteId],
  );

describe('migration 0154: the card sentence becomes a row', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1({ stopBefore: MIGRATION });
    seedUsers(db);
    // A: clue with pinyin, translation and a clip; no set.
    note(db, 'A', 'd-stu', '银行', '我去银行。', {
      sentence_clue_pinyin: 'Wǒ qù yínháng.', sentence_clue_translation: 'I go to the bank.',
      sentence_clue_audio_url: 'generated/clueA.mp3', sentence_clue_audio_provider: 'minimax', sentence_clue_audio_settings: 'h1.abc',
    });
    // B: no clue, a set.
    note(db, 'B', 'd-stu', '学生', null);
    setRow(db, 'b0', 'B', 0, '他是学生。');
    // C: clue repeated word for word by a set row (which has the breakdown), plus another set row.
    note(db, 'C', 'd-stu', '苹果', ' 我吃苹果。 ', { sentence_clue_audio_url: 'generated/clueC.mp3' });
    setRow(db, 'c0', 'C', 0, '我吃苹果。', { translation: 'I eat apples.', pinyin: 'Wǒ chī píngguǒ.', explanation: '{"words":[],"construction":"x"}' });
    setRow(db, 'c1', 'C', 1, '苹果很甜。');
    // T (tutor) and S (student's copy) share one clip key.
    note(db, 'T', 'd-tut', '老师', '她是老师。', { sentence_clue_audio_url: 'generated/shared.mp3' });
    note(db, 'S', 'd-copy', '老师', '她是老师。', { sentence_clue_audio_url: 'generated/shared.mp3' });
    // Practice history on the old 'clue' key stays as it was.
    db.raw.run("INSERT INTO sentence_practice_events (id, user_id, note_id, sentence_key, kind, mode, result, at) VALUES ('e1', 'stu', 'A', 'clue', 'attempt', 'read', 'right', '2026-10-01T00:00:00Z')");
    applyMigrationsFrom(db, MIGRATION);
  });

  it('makes one card row per note with a card sentence, reusing its clip', () => {
    expect(rowsOf(db, 'A')).toEqual([
      { id: 'A-card', position: -1, hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank.', audio_url: 'generated/clueA.mp3', explanation: null, is_card: 1 },
    ]);
    expect(db.rows('SELECT audio_provider, audio_settings FROM note_sentences WHERE id = ?', ['A-card'])).toEqual([{ audio_provider: 'minimax', audio_settings: 'h1.abc' }]);
    expect(rowsOf(db, 'B')).toEqual([expect.objectContaining({ id: 'b0', is_card: 0 })]);
    expect(rowsOf(db, 'T')[0]).toMatchObject({ id: 'T-card', audio_url: 'generated/shared.mp3' });
    expect(rowsOf(db, 'S')[0]).toMatchObject({ id: 'S-card', audio_url: 'generated/shared.mp3' });
    // Nothing is regenerated and the notes are untouched (they stay as the mirror).
    expect(db.rows("SELECT sentence_clue_audio_url AS u FROM notes WHERE id = 'A'")).toEqual([{ u: 'generated/clueA.mp3' }]);
    expect(db.rows("SELECT sentence_key FROM sentence_practice_events")).toEqual([{ sentence_key: 'clue' }]);
  });

  it('merges a set row that repeats the card sentence into the card row', () => {
    const rows = rowsOf(db, 'C');
    expect(rows.map((r) => r.id)).toEqual(['C-card', 'c1']);
    expect(rows[0]).toMatchObject({
      hanzi: '我吃苹果。', is_card: 1, translation: 'I eat apples.', pinyin: 'Wǒ chī píngguǒ.',
      audio_url: 'generated/clueC.mp3', explanation: '{"words":[],"construction":"x"}',
    });
  });

  it('touches every row of a note with a card row, so a sync hands the note out whole', () => {
    const [c1] = db.rows<{ updated_at: string }>("SELECT updated_at FROM note_sentences WHERE id = 'c1'");
    expect(c1.updated_at > '2026-10-01T00:00:00.000Z').toBe(true);
    const [b0] = db.rows<{ updated_at: string }>("SELECT updated_at FROM note_sentences WHERE id = 'b0'");
    expect(b0.updated_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('is idempotent (its data steps run again change nothing)', () => {
    const before = db.rows('SELECT * FROM note_sentences ORDER BY id');
    const sql = fs.readFileSync(path.resolve(__dirname, '../../db/migrations', MIGRATION), 'utf8')
      .replace(/ALTER TABLE[^;]+;/, '')
      .replace(/UPDATE note_sentences\s+SET updated_at[^;]+;/, '');
    db.raw.exec(sql);
    expect(db.rows('SELECT * FROM note_sentences ORDER BY id')).toEqual(before);
  });

  it('knows a card row id', () => {
    expect(noteIdOfCardSentence('A-card')).toBe('A');
    expect(noteIdOfCardSentence('b0')).toBeNull();
    expect(noteIdOfCardSentence('-card')).toBeNull();
  });
});

describe('writes to the card sentence (old clients, MCP, Claude, copies) land in the row', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seedUsers(db);
  });

  it('create / edit / clear through the note fields', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。', sentence_clue_pinyin: 'Wǒ qù yínháng.' });
    expect(rowsOf(db, created.id)).toEqual([expect.objectContaining({ id: `${created.id}-card`, hanzi: '我去银行。', pinyin: 'Wǒ qù yínháng.', translation: null, is_card: 1 })]);

    // A breakdown cached on the row survives an edit that keeps the text; a new text drops it.
    db.raw.run("UPDATE note_sentences SET explanation = '{}' WHERE id = ?", [`${created.id}-card`]);
    await q.updateNote(D1(db), created.id, 'stu', { sentenceClueTranslation: 'I go to the bank.' });
    expect(rowsOf(db, created.id)[0]).toMatchObject({ translation: 'I go to the bank.', explanation: '{}' });
    await q.updateNote(D1(db), created.id, 'stu', { sentenceClue: '银行在哪儿？', sentenceCluePinyin: 'Yínháng zài nǎr?', sentenceClueTranslation: 'Where is the bank?' });
    expect(rowsOf(db, created.id)[0]).toMatchObject({ hanzi: '银行在哪儿？', pinyin: 'Yínháng zài nǎr?', translation: 'Where is the bank?', explanation: null });

    // A set row is kept; clearing the card sentence removes only the card row.
    setRow(db, 's1', created.id, 0, '这是银行。');
    await q.updateNote(D1(db), created.id, 'stu', { sentenceClue: '' });
    expect(rowsOf(db, created.id).map((r) => r.id)).toEqual(['s1']);
  });

  it('a note without a card sentence gets no row', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '书', pinyin: 'shū', english: 'book' });
    expect(rowsOf(db, created.id)).toEqual([]);
  });

  it('a tutor edit carried to the student copy moves its row, the shared clip key kept', async () => {
    note(db, 'T', 'd-tut', '老师', '她是老师。', { sentence_clue_audio_url: 'generated/shared.mp3' });
    db.raw.run("UPDATE notes SET updated_at = '2026-09-01 00:00:00' WHERE id = 'T'");
    const copyId = await q.insertNoteCopy(D1(db), 'd-copy', db.rows<Record<string, unknown>>("SELECT * FROM notes WHERE id = 'T'")[0]);
    expect(rowsOf(db, copyId)[0]).toMatchObject({ id: `${copyId}-card`, hanzi: '她是老师。', audio_url: 'generated/shared.mp3' });

    // The tutor writes a new sentence later than the copy was touched.
    db.raw.run("UPDATE notes SET updated_at = '2026-09-01 00:00:00' WHERE id = ?", [copyId]);
    await q.updateNote(D1(db), 'T', { sentenceClue: '我的老师很好。', sentenceClueTranslation: 'My teacher is nice.' });
    db.raw.run("UPDATE notes SET updated_at = '2026-10-01 00:00:00' WHERE id = 'T'");
    const result = await updateSharedDeckCopy(D1(db), 'rel', 'tut', 'share');
    expect(result.updated).toBe(1);
    expect(rowsOf(db, copyId)[0]).toMatchObject({ hanzi: '我的老师很好。', translation: 'My teacher is nice.', is_card: 1 });
    expect(rowsOf(db, 'T')[0]).toMatchObject({ hanzi: '我的老师很好。' });
  });

  it('regenerating or deleting the set keeps the card row; a top-up appends after the set', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。' });
    const input = (hanzi: string) => ({ hanzi, pinyin: null, translation: null, audioUrl: null, focus: 'core', focusNote: null });
    let rows = await q.replaceNoteSentences(D1(db), created.id, [input('一'), input('二')]);
    expect(rows.map((r) => [r.hanzi, r.position, r.is_card])).toEqual([['我去银行。', -1, 1], ['一', 0, 0], ['二', 1, 0]]);
    rows = await q.replaceNoteSentences(D1(db), created.id, [input('三')]);
    expect(rows.map((r) => r.hanzi)).toEqual(['我去银行。', '三']);
    rows = await q.appendNoteSentences(D1(db), created.id, [input('四')]);
    expect(rows.map((r) => [r.hanzi, r.position])).toEqual([['我去银行。', -1], ['三', 0], ['四', 1]]);
    await q.deleteNoteSentences(D1(db), created.id);
    expect(rowsOf(db, created.id).map((r) => r.id)).toEqual([`${created.id}-card`]);
  });

  it('a note with only its card row still needs a generated set', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。' });
    const need = await q.getNotesNeedingSentenceSets(D1(db), 'stu', 10);
    expect(need.map((n) => n.id)).toContain(created.id);
    expect(await q.countNotesWithoutSentenceSets(D1(db), 'stu')).toBe(1);
  });

  it('/api/sentences/changes hands whole notes out, and says which notes lost their rows', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。' });
    setRow(db, 's1', created.id, 0, '这是银行。');
    const since = '2026-10-15T00:00:00.000Z';
    db.raw.run('UPDATE note_sentences SET updated_at = ?', ['2026-10-01T00:00:00.000Z']);
    db.raw.run("UPDATE notes SET updated_at = '2026-10-01 00:00:00'");
    // Only the set row changes: both rows come down.
    db.raw.run("UPDATE note_sentences SET updated_at = '2026-10-16T00:00:00.000Z' WHERE id = 's1'");
    let page = await q.getNoteSentencesForUser(D1(db), 'stu', since);
    expect(page.sentences.map((r) => r.id).sort()).toEqual([`${created.id}-card`, 's1']);
    expect(page.noteIds).toEqual([created.id]);

    // The card sentence is removed by a path that only wrote the note: the reconcile catches it,
    // and the note comes down with its one remaining row.
    db.raw.run("UPDATE notes SET sentence_clue = NULL, updated_at = '2026-10-17 00:00:00' WHERE id = ?", [created.id]);
    db.raw.run("UPDATE note_sentences SET updated_at = '2026-10-01T00:00:00.000Z'");
    await reconcileCardSentencesForUser(D1(db), 'stu', '2026-10-16T12:00:00.000Z');
    page = await q.getNoteSentencesForUser(D1(db), 'stu', '2026-10-16T12:00:00.000Z');
    expect(page.sentences.map((r) => r.id)).toEqual(['s1']);
    expect(page.noteIds).toEqual([created.id]);

    // Full dump: every row, no note list.
    const full = await q.getNoteSentencesForUser(D1(db), 'stu', null);
    expect(full.noteIds).toBeNull();
    expect(full.sentences.map((r) => r.id)).toEqual(['s1']);
  });

  it('the reconcile writes nothing when rows already match', async () => {
    const created = await q.createNote(D1(db), 'd-stu', { hanzi: '银行', pinyin: 'yínháng', english: 'bank', sentence_clue: '我去银行。' });
    db.raw.run("UPDATE note_sentences SET updated_at = '2026-10-01T00:00:00.000Z'");
    await syncCardSentences(D1(db), [created.id]);
    await reconcileCardSentencesForUser(D1(db), 'stu', null);
    expect(db.rows('SELECT updated_at FROM note_sentences')).toEqual([{ updated_at: '2026-10-01T00:00:00.000Z' }]);
  });
});
