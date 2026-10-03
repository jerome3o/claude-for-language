/**
 * Taking homework back, against a REAL SQLite with every migration and FKs on:
 * only the relationship's tutor may do it, only the student's COPY of what she
 * sent is reachable (never the student's own decks), the delete goes through
 * the content service (tombstones + unshared clips only), the share row and
 * the assignments go, and the session-notes job is stamped.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  RemovalError,
  markResultRemoved,
  previewDeckRemoval,
  previewLessonRemoval,
  previewReaderRemoval,
  removeStudentDeck,
  removeStudentLesson,
  removeStudentReader,
} from '../homework-removal';
import type { Env } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const OTHER_TUTOR = 'tutor-2';
const OTHER_STUDENT = 'student-2';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function fakeEnv(db: SqliteD1) {
  const deleted: string[] = [];
  const env = {
    DB: db,
    AUDIO_BUCKET: {
      delete: async (keys: string | string[]) => {
        deleted.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    } as unknown as R2Bucket,
  } as unknown as Env;
  return { env, deleted };
}

function seed(db: SqliteD1) {
  for (const id of [TUTOR, STUDENT, OTHER_TUTOR, OTHER_STUDENT]) {
    exec(db, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', id, `${id}@example.com`, id, 'student');
  }
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-2', ?, ?, 'student', 'active')", STUDENT, OTHER_TUTOR);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-3', ?, ?, 'student', 'active')", OTHER_STUDENT, TUTOR);

  // The HSK deck the agent sent by accident: tutor source → student copy, sharing a clip.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t-hsk', ?, 'HSK 1')", TUTOR);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES ('t-n1', 't-hsk', '爱', 'ài', 'love', 'generated/ai.mp3')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-hsk', ?, 'HSK 1 (from tutor)')", STUDENT);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES ('s-n1', 's-hsk', '爱', 'ài', 'love', 'generated/ai.mp3')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES ('s-n2', 's-hsk', '八', 'bā', 'eight', 'generated/student-only.mp3')");
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('s-c1', 's-n1', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('s-c2', 's-n2', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('ev-1', 's-c1', ?, 2, '2026-10-02')", STUDENT);
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('ev-2', 's-c1', ?, 3, '2026-10-03')", STUDENT);
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-1', 'rel-1', 't-hsk', 's-hsk')");
  exec(db, "INSERT INTO assignments (id, relationship_id, tutor_id, student_id, kind, target_id, title, mode) VALUES ('as-1', 'rel-1', ?, ?, 'deck', 's-hsk', 'HSK 1', 'both')", TUTOR, STUDENT);
  exec(db, `INSERT INTO tutor_note_jobs (id, relationship_id, tutor_id, student_id, notes, result) VALUES ('job-1', 'rel-1', ?, ?, 'notes', '{"deck":{"id":"t-hsk","name":"HSK 1","note_count":1,"target_deck_id":"s-hsk"}}')`, TUTOR, STUDENT);

  // The student's OWN deck.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-own', ?, 'My words')", STUDENT);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('s-own-n', 's-own', '猫', 'māo', 'cat')");

  // A deck another tutor sent the same student.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('o-src', ?, 'Other')", OTHER_TUTOR);
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-other', ?, 'Other (from tutor)')", STUDENT);
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-o', 'rel-2', 'o-src', 's-other')");

  // Lessons: one this tutor assigned, one the student made.
  exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec, library_item_id, assigned_by, assigned_relationship_id) VALUES ('s-lesson', ?, 'Tones', '{}', 'lib-1', ?, 'rel-1')", STUDENT, TUTOR);
  exec(db, "INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('lc-1', ?, 's-lesson', 3, 4, '2026-10-02')", STUDENT);
  exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('s-mine', ?, 'Mine', '{}')", STUDENT);

  // Reader: tutor's + the student's copy sharing one picture.
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('t-reader', ?, '小猫', 'Kitten', 'beginner', '[]', '[]')", TUTOR);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('t-page', 't-reader', 1, 'p', 'e', '小猫', 'reader-images/shared.png')");
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('s-reader', ?, '小猫', 'Kitten', 'beginner', '[]', '[]')", STUDENT);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('s-page', 's-reader', 1, 'p', 'e', '小猫', 'reader-images/shared.png')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('s-page2', 's-reader', 2, 'p', 'e', '家', 'reader-images/copy-only.png')");
  exec(db, "INSERT INTO shared_readers (id, relationship_id, source_reader_id, target_reader_id) VALUES ('rshare-1', 'rel-1', 't-reader', 's-reader')");
}

let db: SqliteD1;
beforeEach(async () => {
  db = await createSqliteD1();
  seed(db);
});

async function expectError(p: Promise<unknown>, status: number) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(RemovalError);
  expect((err as RemovalError).status).toBe(status);
}

describe('removeStudentDeck', () => {
  it('previews what the student would lose', async () => {
    const p = await previewDeckRemoval(db, 'rel-1', TUTOR, 'share-1');
    expect(p).toMatchObject({ shared_deck_id: 'share-1', target_deck_id: 's-hsk', deck_name: 'HSK 1 (from tutor)', words_total: 2, words_met: 1, reviews: 2, can_delete_source: true });
    // Nothing was written.
    expect(db.rows("SELECT id FROM decks WHERE id = 's-hsk'")).toHaveLength(1);
  });

  it("deletes the student's copy with tombstones, cancels its homework and drops the share", async () => {
    const { env, deleted } = fakeEnv(db);
    const r = await removeStudentDeck(env, 'rel-1', TUTOR, 'share-1');
    expect(r).toMatchObject({ removed: true, words_met: 1, reviews: 2, assignments_cancelled: 1, source_deleted: false });
    expect(db.rows("SELECT id FROM decks WHERE id = 's-hsk'")).toHaveLength(0);
    expect(db.rows("SELECT id FROM review_events WHERE user_id = ?", [STUDENT])).toHaveLength(0);
    expect(db.rows("SELECT id FROM shared_decks WHERE id = 'share-1'")).toHaveLength(0);
    // Tombstones for the student's devices.
    const tombs = db.rows<{ kind: string; item_id: string; user_id: string }>('SELECT kind, item_id, user_id FROM deleted_items ORDER BY kind, item_id');
    expect(tombs).toEqual([
      { kind: 'deck', item_id: 's-hsk', user_id: STUDENT },
      { kind: 'note', item_id: 's-n1', user_id: STUDENT },
      { kind: 'note', item_id: 's-n2', user_id: STUDENT },
    ]);
    // Only the clip nothing else uses goes; the tutor's deck keeps the shared one.
    expect(deleted).toEqual(['generated/student-only.mp3']);
    expect(db.rows("SELECT status FROM assignments WHERE id = 'as-1'")).toEqual([{ status: 'cancelled' }]);
    const job = JSON.parse(db.rows<{ result: string }>("SELECT result FROM tutor_note_jobs WHERE id = 'job-1'")[0].result);
    expect(job.deck.removed_at).toBeTruthy();
    // The tutor's own deck is untouched.
    expect(db.rows("SELECT id FROM decks WHERE id = 't-hsk'")).toHaveLength(1);
  });

  it('finds the share by the student copy id (the job card only knows that)', async () => {
    const { env } = fakeEnv(db);
    await removeStudentDeck(env, 'rel-1', TUTOR, 's-hsk');
    expect(db.rows("SELECT id FROM decks WHERE id = 's-hsk'")).toHaveLength(0);
  });

  it('also deletes her source deck when asked and no one else has a copy', async () => {
    const { env } = fakeEnv(db);
    const r = await removeStudentDeck(env, 'rel-1', TUTOR, 'share-1', { deleteSource: true });
    expect(r.source_deleted).toBe(true);
    expect(db.rows("SELECT id FROM decks WHERE id IN ('t-hsk', 's-hsk')")).toHaveLength(0);
    expect(db.rows("SELECT item_id FROM deleted_items WHERE user_id = ? AND kind = 'deck'", [TUTOR])).toEqual([{ item_id: 't-hsk' }]);
  });

  it('keeps her source deck when another student still has a copy', async () => {
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s2-hsk', ?, 'HSK 1 (from tutor)')", OTHER_STUDENT);
    exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-2', 'rel-3', 't-hsk', 's2-hsk')");
    expect((await previewDeckRemoval(db, 'rel-1', TUTOR, 'share-1')).can_delete_source).toBe(false);
    const { env } = fakeEnv(db);
    const r = await removeStudentDeck(env, 'rel-1', TUTOR, 'share-1', { deleteSource: true });
    expect(r.source_deleted).toBe(false);
    expect(db.rows("SELECT id FROM decks WHERE id IN ('t-hsk', 's2-hsk')")).toHaveLength(2);
  });

  it('only the tutor of that relationship may call it', async () => {
    const { env } = fakeEnv(db);
    // The student themself (they delete from the deck page instead).
    await expectError(removeStudentDeck(env, 'rel-1', STUDENT, 'share-1'), 403);
    // Another tutor of the same student.
    await expectError(removeStudentDeck(env, 'rel-1', OTHER_TUTOR, 'share-1'), 404);
    // A share of another relationship through this tutor's relationship.
    await expectError(removeStudentDeck(env, 'rel-1', TUTOR, 'share-o'), 404);
    await expectError(previewDeckRemoval(db, 'rel-3', TUTOR, 'share-1'), 404);
    expect(db.rows("SELECT id FROM decks WHERE id IN ('s-hsk', 's-other')")).toHaveLength(2);
  });

  it("can never touch the student's own decks", async () => {
    const { env } = fakeEnv(db);
    await expectError(removeStudentDeck(env, 'rel-1', TUTOR, 's-own'), 404);
    await expectError(removeStudentDeck(env, 'rel-1', TUTOR, 's-other'), 404);
    // Even a crafted share row pointing at a deck the student owns under another tutor: only rel-1 rows count.
    expect(db.rows("SELECT id FROM decks WHERE id IN ('s-own', 's-other')")).toHaveLength(2);
    expect(db.rows("SELECT id FROM deleted_items")).toHaveLength(0);
  });

  it('a copy the student already deleted just drops the share', async () => {
    exec(db, "DELETE FROM decks WHERE id = 's-hsk'");
    const { env } = fakeEnv(db);
    const r = await removeStudentDeck(env, 'rel-1', TUTOR, 'share-1');
    expect(r).toMatchObject({ removed: true, words_met: 0, reviews: 0 });
    expect(db.rows("SELECT id FROM shared_decks WHERE id = 'share-1'")).toHaveLength(0);
    await expectError(removeStudentDeck(env, 'rel-1', TUTOR, 'share-1'), 404);
  });
});

describe('removeStudentLesson', () => {
  it('deletes the copy she assigned; the library item and the student lessons stay', async () => {
    expect(await previewLessonRemoval(db, 'rel-1', TUTOR, 's-lesson')).toMatchObject({ title: 'Tones', completions: 1 });
    const { env } = fakeEnv(db);
    const r = await removeStudentLesson(env, 'rel-1', TUTOR, 's-lesson');
    expect(r).toMatchObject({ removed: true, reviews: 1 });
    expect(db.rows("SELECT id FROM custom_lessons WHERE user_id = ?", [STUDENT])).toEqual([{ id: 's-mine' }]);
  });

  it("refuses the student's own lessons and other people", async () => {
    const { env } = fakeEnv(db);
    await expectError(removeStudentLesson(env, 'rel-1', TUTOR, 's-mine'), 404);
    await expectError(removeStudentLesson(env, 'rel-1', STUDENT, 's-lesson'), 403);
    await expectError(removeStudentLesson(env, 'rel-2', OTHER_TUTOR, 's-lesson'), 404);
    expect(db.rows("SELECT id FROM custom_lessons WHERE user_id = ?", [STUDENT])).toHaveLength(2);
  });
});

describe('removeStudentReader', () => {
  it("deletes the copy, keeping a picture the tutor's reader still uses", async () => {
    expect(await previewReaderRemoval(db, 'rel-1', TUTOR, 'rshare-1')).toMatchObject({ title: '小猫', page_count: 2, readings: 0 });
    const { env, deleted } = fakeEnv(db);
    await removeStudentReader(env, 'rel-1', TUTOR, 's-reader');
    expect(db.rows("SELECT id FROM graded_readers WHERE id = 's-reader'")).toHaveLength(0);
    expect(db.rows("SELECT id FROM shared_readers")).toHaveLength(0);
    expect(deleted).toEqual(['reader-images/copy-only.png']);
    expect(db.rows("SELECT id FROM graded_readers WHERE id = 't-reader'")).toHaveLength(1);
  });

  it('only the tutor of that relationship', async () => {
    const { env } = fakeEnv(db);
    await expectError(removeStudentReader(env, 'rel-1', STUDENT, 'rshare-1'), 403);
    await expectError(removeStudentReader(env, 'rel-2', OTHER_TUTOR, 'rshare-1'), 404);
  });
});

describe('markResultRemoved', () => {
  it('stamps the matching item only once', () => {
    const result = { lessons: [{ lesson_id: 'a' }, { lesson_id: 'b' }] } as Record<string, unknown>;
    expect(markResultRemoved(result, 'lesson', 'b', 'T')).toBe(true);
    expect(markResultRemoved(result, 'lesson', 'b', 'T2')).toBe(false);
    expect(result.lessons).toEqual([{ lesson_id: 'a' }, { lesson_id: 'b', removed_at: 'T' }]);
    expect(markResultRemoved({ reader: { target_reader_id: 'x' } }, 'reader', 'y', 'T')).toBe(false);
  });
});
