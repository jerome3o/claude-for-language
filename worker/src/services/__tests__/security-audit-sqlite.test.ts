/**
 * Security audit (Nov 2026), on real SQLite: a reply quotes only a message of its own chat, and a
 * tutor the student removed can no longer open / overwrite the lessons they once assigned.
 */
import { describe, it, expect } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { sendMessage } from '../conversations';
import { getLessonForEditor, listAssignmentsForItem } from '../../db/lesson-library-queries';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

async function seed(): Promise<SqliteD1> {
  const db = await createSqliteD1();
  for (const [id, role] of [['tutor', 'tutor'], ['student', 'student'], ['other', 'student']]) {
    exec(db, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', id, `${id}@example.com`, id, role);
  }
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'student', 'tutor', 'active')");
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel2', 'tutor', 'other', 'tutor', 'active')");
  exec(db, "INSERT INTO conversations (id, relationship_id, title) VALUES ('conv', 'rel', 'Chat')");
  exec(db, "INSERT INTO conversations (id, relationship_id, title) VALUES ('conv2', 'rel2', 'Chat')");
  exec(db, "INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('private', 'conv2', 'other', '我的秘密', '2026-11-01T00:00:00Z')");
  exec(db, "INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('mine', 'conv', 'tutor', '你好', '2026-11-01T00:00:00Z')");
  return db;
}

describe('a reply only quotes a message of its own chat', () => {
  it('another chat’s message id is dropped (no quote of its text)', async () => {
    const db = await seed();
    const sent = await sendMessage(db, 'conv', 'student', 'hi', 'private');
    expect(sent.reply_to_message_id).toBeNull();
    expect(JSON.stringify(sent)).not.toContain('我的秘密');
  });
  it('a message of the same chat is quoted as before', async () => {
    const db = await seed();
    const sent = await sendMessage(db, 'conv', 'student', 'hi', 'mine');
    expect(sent.reply_to?.content).toBe('你好');
  });
});

describe('lessons a tutor assigned, after the student removed them', () => {
  async function withLesson(status: string) {
    const db = await seed();
    exec(db, 'UPDATE tutor_relationships SET status = ? WHERE id = ?', status, 'rel');
    exec(db, "INSERT INTO custom_lessons (id, user_id, title, spec, library_item_id, assigned_by, assigned_relationship_id) VALUES ('l1', 'student', 'L', '{}', 'item', 'tutor', 'rel')");
    return db;
  }
  it('active: the tutor can open it, and it is one of the item’s copies', async () => {
    const db = await withLesson('active');
    expect(await getLessonForEditor(db, 'l1', 'tutor')).not.toBeNull();
    expect((await listAssignmentsForItem(db, 'item')).map((r) => r.id)).toEqual(['l1']);
  });
  it('removed: the tutor can neither open it nor push to it; the student still can', async () => {
    const db = await withLesson('removed');
    expect(await getLessonForEditor(db, 'l1', 'tutor')).toBeNull();
    expect(await listAssignmentsForItem(db, 'item')).toEqual([]);
    expect(await getLessonForEditor(db, 'l1', 'student')).not.toBeNull();
  });
});
