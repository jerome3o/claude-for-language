/**
 * Migration 0157: the legacy reader-homework tables (0024–0026) are dropped and
 * notifications is rebuilt without its foreign key to homework_assignments —
 * with foreign keys ON while it runs, as on D1.
 */
import { describe, it, expect } from 'vitest';
import { applyMigrationsFrom, createSqliteD1 } from './sqlite-d1';

const MIGRATION = '0157_drop_legacy_homework_tables.sql';

describe('migration 0157: drop the legacy homework tables', () => {
  it('drops the three tables, keeps every notification and leaves notifications writable', async () => {
    const db = await createSqliteD1({ stopBefore: MIGRATION });
    const run = (sql: string, params: (string | number | null)[] = []) => db.raw.run(sql, params);

    run("INSERT INTO users (id, email, name) VALUES ('t', 't@x', 'T'), ('s', 's@x', 'S')");
    run("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('r', 't', '小猫', 'Kitten', 'beginner', '[]', '[]')");
    run("INSERT INTO homework_assignments (id, tutor_id, student_id, reader_id) VALUES ('hw', 't', 's', 'r')");
    run("INSERT INTO homework_recordings (id, homework_id, page_id, audio_url) VALUES ('hwr', 'hw', 'p', 'recordings/homework/hw/hwr.webm')");
    run("INSERT INTO homework_feedback (id, homework_id, tutor_id, audio_feedback_url) VALUES ('hwf', 'hw', 't', 'recordings/feedback/hw/hwf.webm')");
    run("INSERT INTO notifications (id, user_id, type, title, homework_id) VALUES ('n-hw', 's', 'homework_assigned', 'Homework', 'hw')");
    run("INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at, note_id, conversation_id, relationship_id) VALUES ('n-chat', 's', 'new_chat_message', 'Hi', 'msg', 1, '2026-11-01 10:00:00', 'note', 'conv', 'rel')");

    applyMigrationsFrom(db, MIGRATION);

    const tables = db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const gone of ['homework_assignments', 'homework_recordings', 'homework_feedback', 'notifications_rebuilt']) expect(tables).not.toContain(gone);
    expect(tables).toContain('notifications');

    // Every row kept (the cascade never ran), column values intact, homework_id gone.
    expect(db.rows('SELECT * FROM notifications ORDER BY id')).toEqual([
      { id: 'n-chat', user_id: 's', type: 'new_chat_message', title: 'Hi', message: 'msg', is_read: 1, created_at: '2026-11-01 10:00:00', note_id: 'note', conversation_id: 'conv', relationship_id: 'rel' },
      expect.objectContaining({ id: 'n-hw', user_id: 's', type: 'homework_assigned', title: 'Homework', is_read: 0 }),
    ]);
    const indexes = db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' AND name LIKE 'idx_%'").map((r) => r.name).sort();
    expect(indexes).toEqual(['idx_notifications_user', 'idx_notifications_user_unread']);

    // Inserts / updates / deletes work with foreign keys on (they failed with
    // "no such table: main.homework_assignments" had the FK stayed).
    run("INSERT INTO notifications (id, user_id, type, title, message, note_id, conversation_id, relationship_id) VALUES ('n-new', 's', 'new_chat_message', 'x', null, null, 'conv', null)");
    run("UPDATE notifications SET is_read = 1 WHERE user_id = 's'");
    run("DELETE FROM notifications WHERE id = 'n-hw'");
    expect(db.rows('SELECT id FROM notifications ORDER BY id').map((r) => (r as { id: string }).id)).toEqual(['n-chat', 'n-new']);
    expect(db.rows('PRAGMA foreign_key_check')).toEqual([]);
    expect(() => run("INSERT INTO notifications (id, user_id, type, title) VALUES ('bad', 'nobody', 'x', 'y')")).toThrow(/FOREIGN KEY/);
  });
});
