/**
 * A chat with more than 100 messages still loads (Nov 2026: the full load bound every
 * message id in ONE reactions query; D1 refuses > 100 bound parameters, so the chat with
 * Jerome's tutor stopped loading the moment it passed 100 messages and her new message
 * never showed). Real SQLite with D1's parameter limit (sqlite-d1.ts).
 */
import { describe, it, expect } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getMessages } from '../conversations';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

async function seedChat(count: number): Promise<SqliteD1> {
  const db = await createSqliteD1();
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('tutor', 't@example.com', 'Tutor', 'tutor')");
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('student', 's@example.com', 'Student', 'student')");
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'student', 'tutor', 'active')");
  exec(db, "INSERT INTO conversations (id, relationship_id, title) VALUES ('conv', 'rel', 'Chat')");
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString();
    exec(db, 'INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
      `m${String(i).padStart(3, '0')}`, 'conv', i % 2 ? 'tutor' : 'student', `你好 ${i}`, at);
  }
  return db;
}

describe('a chat past 100 messages', () => {
  it('loads every message, with reactions from every batch', async () => {
    const db = await seedChat(230);
    exec(db, "INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r1', 'm005', 'tutor', '👍')");
    exec(db, "INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r2', 'm150', 'student', '❤️')");
    exec(db, "INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES ('r3', 'm229', 'tutor', '😂')");

    const { messages } = await getMessages(db, 'conv', 'student');
    expect(messages).toHaveLength(230);
    expect(messages.at(-1)?.content).toBe('你好 229');
    const byId = new Map(messages.map((m) => [m.id, m]));
    expect(byId.get('m005')!.reactions).toEqual([{ emoji: '👍', users: [{ id: 'tutor', name: 'Tutor' }], count: 1 }]);
    expect(byId.get('m150')?.reactions?.map((r) => r.emoji)).toEqual(['❤️']);
    expect(byId.get('m229')?.reactions?.map((r) => r.emoji)).toEqual(['😂']);
    expect(byId.get('m100')!.reactions).toEqual([]);
  });

  it('exactly 101 messages (the one that broke it) loads', async () => {
    const db = await seedChat(101);
    const { messages } = await getMessages(db, 'conv', 'tutor');
    expect(messages.map((m) => m.id).at(-1)).toBe('m100');
  });
});
