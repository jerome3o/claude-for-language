/**
 * HARD RULE: a Claude chat never reads the tutor's private profile of a student (`student_profiles`,
 * shared/students/profile.ts — "never visible to the student"). The learner's agent sees the learner's
 * own rows only.
 *
 * Two checks: (1) no harness source reads the table or imports the profile helpers; (2) every context
 * run against a database holding a profile of this learner sends none of it to the model and never
 * names the table in a query.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1 } from '../../__tests__/sqlite-d1';
import { CONTEXT_KINDS, runClaudeTurn, type ClaudeContext, type ContextKind } from '..';

const ROOT = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** Code with comments taken out (the docs may NAME the rule; the code must not break it). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no Claude chat reads the tutor’s private student profile', () => {
  it('no harness source queries student_profiles or imports the profile helpers', () => {
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = code(fs.readFileSync(f, 'utf8'));
      expect(src, f).not.toMatch(/student_profiles/i);
      expect(src, f).not.toMatch(/studentProfilePrompt|@shared\/students|student-profile/);
    }
  });

  it('every context, run with a profile in the database: none of it reaches the model, no query names the table', async () => {
    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'a@x.test', 'Jerome', 'student')");
    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('t1', 't@x.test', 'Minghui', 'tutor')");
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 2')");
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '银行', 'yínháng', 'bank')");
    db.raw.run("INSERT INTO cards (id, note_id, card_type, queue) VALUES ('c1', 'n1', 'hanzi_to_meaning', 2)");
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('r1', 't1', 'u1', 'tutor', 'active')");
    db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('cv1', 'r1')");
    db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ('m1', 'cv1', 't1', '你好')");
    const SECRET = 'PRIVATE-TUTOR-NOTE-7f3a';
    db.raw.run("INSERT INTO student_profiles (relationship_id, tutor_id, student_id, body, level) VALUES ('r1', 't1', 'u1', ?, 'intermediate')", [SECRET]);

    const queries: string[] = [];
    const prepare = db.prepare.bind(db);
    const spied = Object.assign(Object.create(db), {
      prepare: (sql: string) => (queries.push(sql), prepare(sql)),
      batch: db.batch.bind(db),
    }) as D1Database;

    const contexts: Record<ContextKind, ClaudeContext> = {
      general: { kind: 'general' },
      card: { kind: 'card', note_id: 'n1' },
      coach: { kind: 'coach' },
      chat_message: { kind: 'chat_message', message_id: 'm1' },
    };
    for (const kind of CONTEXT_KINDS) {
      const seen: unknown[] = [];
      let round = 0;
      const create = vi.fn(async (p: unknown) => {
        seen.push(p);
        round++;
        return round === 1 && kind !== 'general'
          ? { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'search_cards', input: { query: '银' } }], usage: {} }
          : { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '好' }], usage: {} };
      });
      await runClaudeTurn(
        { DB: spied, ANTHROPIC_API_KEY: 'k' },
        contexts[kind],
        { userId: 'u1', language: 'zh', turns: [{ role: 'user', content: '你好' }] },
        { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'> },
      );
      expect(JSON.stringify(seen), kind).not.toContain(SECRET);
    }
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).not.toMatch(/student_profiles/i);
  });
});
