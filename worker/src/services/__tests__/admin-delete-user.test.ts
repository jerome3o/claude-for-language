/**
 * Account deletion against a REAL SQLite with every migration applied and
 * foreign keys on: nothing of the deleted user survives anywhere, other
 * accounts' copies do, the batch is atomic, and only unshared R2 keys go.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  AccountDeletionError,
  deleteUserAccount,
  previewUserDeletion,
} from '../admin/delete-user';
import { inspectUser, inspectUserDecks, resolveUserRef, setUserRole } from '../admin/inspect';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const OTHER = 'other-1';
const ADMIN = 'admin-1';

function fakeBucket() {
  const deleted: string[] = [];
  return {
    deleted,
    bucket: {
      delete: async (keys: string | string[]) => {
        deleted.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    } as unknown as R2Bucket,
  };
}

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

/** A tutor with everything, a student with copies of the tutor's work, and a bystander. */
function seed(db: SqliteD1) {
  const users: Array<[string, string, number]> = [[TUTOR, 'mh@example.com', 0], [STUDENT, 'jerome@example.com', 0], [OTHER, 'other@example.com', 0], [ADMIN, 'admin@example.com', 1]];
  for (const [id, email, admin] of users) {
    exec(db, 'INSERT INTO users (id, email, name, role, is_admin) VALUES (?, ?, ?, ?, ?)', id, email, id, 'student', admin);
  }
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", STUDENT, TUTOR);
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-ai', ?, 'claude-ai', 'student', 'active')", TUTOR);

  // Tutor's deck, shared → the student's copy shares the word clip.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('t-deck', ?, 'MH Lesson 8.3')", TUTOR);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, sentence_clue_audio_url) VALUES ('t-note', 't-deck', '边', 'biān', 'side', 'generated/shared.mp3', 'generated/tutor-only-clue.mp3')");
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('t-card', 't-note', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO note_sentences (id, note_id, position, hanzi, pinyin, translation, audio_url) VALUES ('t-sent', 't-note', 0, '一边走一边说', 'yībiān', 'while', 'generated/tutor-sentence.mp3')");
  exec(db, "INSERT INTO note_questions (id, note_id, question, answer) VALUES ('t-q', 't-note', 'q', 'a')");
  exec(db, "INSERT INTO card_checkpoints (card_id, checkpoint_at, event_count, queue, learning_step, ease_factor, interval, repetitions) VALUES ('t-card', '2026-09-01', 1, 1, 0, 2.5, 0, 0)");
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('t-ev', 't-card', ?, 2, '2026-09-01', 'recordings/t-ev.webm')", TUTOR);

  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('s-copy', ?, 'MH Lesson 8.3 (from tutor)')", STUDENT);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES ('s-note', 's-copy', '边', 'biān', 'side', 'generated/shared.mp3')");
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('s-card', 's-note', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('s-ev', 's-card', ?, 0, '2026-09-02', 'recordings/s-ev.webm')", STUDENT);
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-1', 'rel-1', 't-deck', 's-copy')");
  exec(db, "INSERT INTO tutor_recording_marks (review_event_id, tutor_id, status) VALUES ('s-ev', ?, 'needs_work')", TUTOR);

  // Chat, flags, lesson log, summaries, notes jobs, call.
  exec(db, "INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Chat')");
  exec(db, "INSERT INTO messages (id, conversation_id, sender_id, content, recording_url) VALUES ('m-1', 'conv-1', ?, '你好', 'recordings/msg.webm')", TUTOR);
  exec(db, "INSERT INTO messages (id, conversation_id, sender_id, content, reply_to_message_id) VALUES ('m-2', 'conv-1', ?, 'hi', 'm-1')", STUDENT);
  exec(db, "INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r-1', 'm-1', ?, '👍')", STUDENT);
  exec(db, "INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, message) VALUES ('f-1', 'rel-1', ?, ?, 's-note', 'help')", STUDENT, TUTOR);
  exec(db, "INSERT INTO tutor_lesson_log (id, relationship_id, tutor_id, student_id, lesson_at) VALUES ('ll-1', 'rel-1', ?, ?, '2026-09-20')", TUTOR, STUDENT);
  exec(db, "INSERT INTO student_summaries (id, relationship_id, range_from, range_to, narrative_en, narrative_zh, stats_json) VALUES ('ss-1', 'rel-1', 'a', 'b', 'en', 'zh', '{}')");
  exec(db, "INSERT INTO tutor_note_jobs (id, relationship_id, tutor_id, student_id, notes) VALUES ('job-1', 'rel-1', ?, ?, 'notes')", TUTOR, STUDENT);
  exec(db, "INSERT INTO calls (id, relationship_id, created_by) VALUES ('call-1', 'rel-1', ?)", TUTOR);
  exec(db, "INSERT INTO call_recording_pieces (id, call_id, user_id, piece_index, started_at, audio_key) VALUES ('piece-1', 'call-1', ?, 0, 0, 'calls/piece-1.webm')", STUDENT);
  exec(db, "INSERT INTO call_recording_chunks (piece_id, idx, r2_key, size_bytes) VALUES ('piece-1', 0, 'calls/piece-1/0', 10)");
  exec(db, "INSERT INTO call_transcript_segments (id, call_id, piece_id, user_id, start_ms, end_ms, text) VALUES ('seg-1', 'call-1', 'piece-1', ?, 0, 1, '你好')", STUDENT);
  exec(db, "INSERT INTO notifications (id, user_id, type, title, message, relationship_id) VALUES ('n-1', ?, 'message', 't', 'm', 'rel-1')", STUDENT);

  // Readers: shared copy keeps the image; a private one does not.
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('t-reader', ?, '小猫', 'Kitten', 'beginner', '[]', '[]')", TUTOR);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('t-page', 't-reader', 1, 'p', 'e', '小猫', 'reader-images/shared.png')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('t-page2', 't-reader', 2, 'p', 'e', '家', 'reader-images/tutor-only.png')");
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('s-reader', ?, '小猫', 'Kitten', 'beginner', '[]', '[]')", STUDENT);
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('s-page', 's-reader', 1, 'p', 'e', '小猫', 'reader-images/shared.png')");
  exec(db, "INSERT INTO shared_readers (id, relationship_id, source_reader_id, target_reader_id) VALUES ('sr-1', 'rel-1', 't-reader', 's-reader')");
  exec(db, "INSERT INTO homework_assignments (id, tutor_id, student_id, reader_id) VALUES ('hw-1', ?, ?, 't-reader')", TUTOR, STUDENT);
  exec(db, "INSERT INTO homework_recordings (id, homework_id, page_id, audio_url) VALUES ('hwr-1', 'hw-1', 't-page', 'homework/hwr-1.webm')");

  // Lessons: library item assigned to the student.
  exec(db, "INSERT INTO lesson_library (id, owner_id, title, spec) VALUES ('lib-1', ?, 'Tones', '{\"image_url\":\"lesson-images/shared.png\"}')", TUTOR);
  exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec, library_item_id, assigned_by, assigned_relationship_id) VALUES ('s-lesson', ?, 'Tones', '{\"image_url\":\"lesson-images/shared.png\"}', 'lib-1', ?, 'rel-1')", STUDENT, TUTOR);
  exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('t-lesson', ?, 'Mine', '{}')", TUTOR);
  exec(db, "INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('clc-1', ?, 't-lesson', 1, 1, 'x')", TUTOR);
  exec(db, "INSERT INTO editor_chats (id, owner_id, target_type, target_id) VALUES ('ec-1', ?, 'library', 'lib-1')", TUTOR);
  exec(db, "INSERT INTO editor_chat_messages (id, chat_id, role, content) VALUES ('ecm-1', 'ec-1', 'user', 'hi')");

  // Sign-in, invites, misc.
  exec(db, "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ('sess-1', ?, '2999-01-01')", TUTOR);
  exec(db, "INSERT INTO invites (id, created_by) VALUES ('inv-1', ?)", TUTOR);
  exec(db, "INSERT INTO invite_redemptions (invite_id, user_id) VALUES ('inv-1', ?)", STUDENT);
  exec(db, "INSERT INTO deleted_items (id, user_id, kind, item_id) VALUES ('del-1', ?, 'deck', 'gone-deck')", TUTOR);
  exec(db, "INSERT INTO feature_requests (id, user_id, content, screenshot_url) VALUES ('fr-1', ?, 'bug', '/api/feature-requests/screenshot/screenshots/tutor-1/x.png')", TUTOR);
  exec(db, "INSERT INTO quests (id, user_id, title, status, world) VALUES ('q-1', ?, 'Q', 'ready', '{}')", TUTOR);
  exec(db, "INSERT INTO coach_conversations (id, user_id, title) VALUES ('cc-1', ?, 'c')", TUTOR);
  exec(db, "INSERT INTO study_sessions (id, user_id, deck_id) VALUES ('ss-study', ?, 't-deck')", TUTOR);
  exec(db, "INSERT INTO sync_metadata (user_id, last_event_at, last_sync_at) VALUES (?, 'a', 'b')", TUTOR);
  exec(db, "INSERT INTO lesson_notes (id, user_id, raw_text) VALUES ('ln-1', ?, 'notes')", TUTOR);

  // Bystander.
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('o-deck', ?, 'Other')", OTHER);
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('o-note', 'o-deck', '猫', 'māo', 'cat')");
}

/** Every (table, column) whose value is exactly `value` — should be none after deletion. */
function cellsEqualTo(db: SqliteD1, value: string): string[] {
  const hits: string[] = [];
  const tables = db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  for (const { name } of tables) {
    for (const col of db.rows<{ name: string }>(`PRAGMA table_info('${name}')`)) {
      const n = db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}" WHERE "${col.name}" = ?`, [value])[0].n;
      if (n > 0) hits.push(`${name}.${col.name}`);
    }
  }
  return hits;
}

describe('deleteUserAccount', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('previews what goes and what stays', async () => {
    const preview = await previewUserDeletion(db, TUTOR, { actorId: ADMIN });
    expect(preview.blockers).toEqual([]);
    expect(preview.will_delete).toMatchObject({ decks: 1, notes: 1, cards: 1, review_events: 1, recordings: 1, readers: 1, relationships: 2, messages: 2, calls: 1, sessions: 1 });
    expect(preview.will_keep).toEqual({ deck_copies_in_other_accounts: 1, reader_copies_in_other_accounts: 1, lessons_assigned_to_others: 1 });
    expect(preview.r2_objects).toBeGreaterThan(0);
  });

  it('removes every trace of the user, keeps the student\'s copies, and leaves no dangling foreign keys', async () => {
    const { bucket, deleted } = fakeBucket();
    const result = await deleteUserAccount({ DB: db, AUDIO_BUCKET: bucket } as never, TUTOR, { actorId: ADMIN, confirmEmail: 'MH@example.com ' });

    expect(result.deleted.users).toBe(1);
    expect(cellsEqualTo(db, TUTOR)).toEqual([]);
    expect(db.rows('PRAGMA foreign_key_check')).toEqual([]);

    // The student's copies and history are theirs.
    expect(db.rows("SELECT id FROM decks WHERE id = 's-copy'")).toHaveLength(1);
    expect(db.rows("SELECT id FROM notes WHERE id = 's-note'")).toHaveLength(1);
    expect(db.rows("SELECT id FROM review_events WHERE id = 's-ev'")).toHaveLength(1);
    expect(db.rows("SELECT id FROM graded_readers WHERE id = 's-reader'")).toHaveLength(1);
    expect(db.rows("SELECT assigned_by, library_item_id, assigned_relationship_id FROM custom_lessons WHERE id = 's-lesson'"))
      .toEqual([{ assigned_by: null, library_item_id: null, assigned_relationship_id: null }]);
    // The relationship and everything in it are gone (incl. the student's messages there).
    for (const table of ['tutor_relationships', 'conversations', 'messages', 'shared_decks', 'shared_readers', 'card_flags', 'calls', 'call_recording_pieces', 'call_transcript_segments', 'tutor_note_jobs', 'student_summaries', 'tutor_lesson_log', 'homework_assignments', 'tutor_recording_marks']) {
      expect(db.rows(`SELECT COUNT(*) AS n FROM ${table}`)[0], table).toEqual({ n: 0 });
    }
    // The bystander is untouched.
    expect(db.rows("SELECT id FROM notes WHERE deck_id = 'o-deck'")).toHaveLength(1);
    expect(db.rows('SELECT id FROM users ORDER BY id').map((r) => (r as { id: string }).id)).toEqual([ADMIN, 'claude-ai', OTHER, STUDENT]);

    // R2: only keys nothing else uses.
    expect(deleted).toEqual(expect.arrayContaining([
      'generated/tutor-only-clue.mp3', 'generated/tutor-sentence.mp3', 'recordings/t-ev.webm', 'recordings/msg.webm',
      'reader-images/tutor-only.png', 'calls/piece-1.webm', 'calls/piece-1/0', 'homework/hwr-1.webm', 'screenshots/tutor-1/x.png',
    ]));
    expect(deleted).not.toContain('generated/shared.mp3');
    expect(deleted).not.toContain('reader-images/shared.png');
    expect(deleted).not.toContain('lesson-images/shared.png');
    expect(deleted).not.toContain('recordings/s-ev.webm');
    expect(result.kept).toEqual({ deck_copies_in_other_accounts: 1, reader_copies_in_other_accounts: 1, lessons_assigned_to_others: 1 });
  });

  it('deleting the student keeps the tutor\'s deck and the clip their copy shared', async () => {
    const { bucket, deleted } = fakeBucket();
    await deleteUserAccount({ DB: db, AUDIO_BUCKET: bucket } as never, STUDENT, { actorId: ADMIN, confirmEmail: 'jerome@example.com' });
    expect(cellsEqualTo(db, STUDENT)).toEqual([]);
    expect(db.rows('PRAGMA foreign_key_check')).toEqual([]);
    expect(db.rows("SELECT id FROM notes WHERE id = 't-note'")).toHaveLength(1);
    expect(db.rows("SELECT id FROM review_events WHERE id = 't-ev'")).toHaveLength(1);
    expect(deleted).not.toContain('generated/shared.mp3');
    expect(deleted).toContain('recordings/s-ev.webm');
  });

  it('refuses without the exact email, for admins, for the caller and for protected accounts', async () => {
    const env = { DB: db, AUDIO_BUCKET: fakeBucket().bucket } as never;
    await expect(deleteUserAccount(env, TUTOR, { actorId: ADMIN, confirmEmail: 'nope@example.com' })).rejects.toMatchObject({ status: 400 });
    await expect(deleteUserAccount(env, ADMIN, { actorId: 'someone', confirmEmail: 'admin@example.com' })).rejects.toBeInstanceOf(AccountDeletionError);
    await expect(deleteUserAccount(env, TUTOR, { actorId: TUTOR, confirmEmail: 'mh@example.com' })).rejects.toMatchObject({ status: 403 });
    await expect(deleteUserAccount(env, TUTOR, { actorId: ADMIN, adminEmail: 'mh@example.com', confirmEmail: 'mh@example.com' })).rejects.toMatchObject({ status: 403 });
    await expect(deleteUserAccount(env, 'missing', { actorId: ADMIN, confirmEmail: 'x' })).rejects.toMatchObject({ status: 404 });
    expect(db.rows(`SELECT id FROM users WHERE id = '${TUTOR}'`)).toHaveLength(1);
  });

  it('is all-or-nothing: a failing statement leaves the account intact', async () => {
    // A trigger that fails the users delete stands in for any mid-batch error.
    db.raw.exec(`CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    const env = { DB: db, AUDIO_BUCKET: fakeBucket().bucket } as never;
    await expect(deleteUserAccount(env, TUTOR, { actorId: ADMIN, confirmEmail: 'mh@example.com' })).rejects.toThrow('boom');
    expect(db.rows("SELECT id FROM decks WHERE id = 't-deck'")).toHaveLength(1);
    expect(db.rows("SELECT id FROM tutor_relationships WHERE id = 'rel-1'")).toHaveLength(1);
  });
});

describe('admin inspection', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('resolves a user by id or email and sets the role', async () => {
    expect((await resolveUserRef(db, 'MH@Example.com'))?.id).toBe(TUTOR);
    expect((await resolveUserRef(db, TUTOR))?.email).toBe('mh@example.com');
    expect(await resolveUserRef(db, 'nobody@example.com')).toBeNull();
    expect(await setUserRole(db, TUTOR, 'tutor')).toBe(true);
    expect(db.rows(`SELECT role FROM users WHERE id = '${TUTOR}'`)).toEqual([{ role: 'tutor' }]);
  });

  it('reports relationships from the user\'s side and decks incl. deleted and untombstoned ones', async () => {
    const info = await inspectUser(db, TUTOR);
    expect(info?.relationships.find((r) => r.id === 'rel-1')).toMatchObject({ my_role: 'tutor', other: { id: STUDENT } });
    expect(info?.counts).toMatchObject({ decks: 1, deleted_decks: 1 });

    // The tutor deletes a shared deck before tombstones existed: no deleted_items row.
    exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('share-old', 'rel-1', 'pre-0068-deck', 'gone-copy')");
    const decks = await inspectUserDecks(db, TUTOR);
    expect(decks.decks.map((d) => d.id)).toEqual(['t-deck']);
    expect(decks.deleted_decks[0]).toMatchObject({ id: 'gone-deck' });
    expect(decks.shares_sent.map((s) => s.id).sort()).toEqual(['share-1', 'share-old']);
    expect(decks.shares_sent.find((s) => s.id === 'share-old')).toMatchObject({ source_exists: false, target_exists: false });
    expect(decks.untombstoned_deleted_sources).toEqual(['pre-0068-deck']);

    const student = await inspectUserDecks(db, STUDENT);
    expect(student.shares_received.map((s) => s.id).sort()).toEqual(['share-1', 'share-old']);
    expect(student.shares_sent).toEqual([]);
  });
});
