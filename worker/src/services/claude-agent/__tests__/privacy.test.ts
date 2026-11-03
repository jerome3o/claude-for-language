/**
 * HARD RULE: a Claude chat never reads the tutor's private profile of a student (`student_profiles`,
 * shared/students/profile.ts — "never visible to the student"). The learner's agent sees the learner's
 * own rows only.
 *
 * Three checks: (1) no harness source reads the table or imports the profile helpers; (2) every context
 * run against a database holding a profile of this learner sends none of it to the model and never
 * names the table in a query; (3) Claude memory (memory.ts, tools/memory.ts) — the summaries, the digest
 * and the look-ups read the learner's own chats only: its memory reaches the model, the profile never.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1 } from '../../__tests__/sqlite-d1';
import { seedReaderAndLesson } from './context-seed';
import { CONTEXT_KINDS, runClaudeTurn, type ClaudeContext, type ContextKind } from '..';
import { rebuildLearnerDigest, summarizeThread } from '../memory';
import { executeReadChat, executeSearchMyChats } from '../tools/memory';

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
    seedReaderAndLesson(db, 'u1', null);
    const SECRET = 'PRIVATE-TUTOR-NOTE-7f3a';
    db.raw.run("INSERT INTO student_profiles (relationship_id, tutor_id, student_id, body, level) VALUES ('r1', 't1', 'u1', ?, 'intermediate')", [SECRET]);
    // Claude memory: the learner's own digest + a thread with a summary.
    const MEMORY = 'MEMORY-DIGEST-OWN-9c1e';
    db.raw.run("INSERT INTO claude_learner_memory (user_id, digest, threads_index) VALUES ('u1', ?, '[]')", [MEMORY]);
    db.raw.run("INSERT INTO coach_conversations (id, user_id, title, context_kind, summary) VALUES ('th1', 'u1', '银行', 'general', 'Asked about 银行.')");
    db.raw.run("INSERT INTO coach_messages (id, conversation_id, role, content, created_at) VALUES ('th1-a', 'th1', 'user', '银行怎么用？', '2026-11-01 10:00:00')");
    db.raw.run("INSERT INTO coach_messages (id, conversation_id, role, content, created_at) VALUES ('th1-b', 'th1', 'assistant', '放钱的地方。', '2026-11-01 10:00:01')");

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
      reader: { kind: 'reader', reader_id: 'rd1', page_id: 'pg2' },
      exercise: { kind: 'exercise', lesson_id: 'ls1', exercise_key: 's0e1' },
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
      expect(JSON.stringify(seen), kind).toContain(MEMORY);
    }

    // The memory's own model calls and look-ups.
    const memorySeen: unknown[] = [];
    const memoryClient = {
      messages: {
        create: vi.fn(async (p: { tool_choice: { name: string } }) => {
          memorySeen.push(p);
          const input = p.tool_choice.name === 'write_chat_summary' ? { summary: 'Asked about 银行.', topics: ['银行'] } : { notes: 'Working on: 银行' };
          return { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: p.tool_choice.name, input }], usage: { input_tokens: 1, output_tokens: 1 } };
        }),
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    const env = { DB: spied, ANTHROPIC_API_KEY: 'k' };
    expect(await summarizeThread(env, 'th1', { client: memoryClient })).toBe('written');
    expect(await rebuildLearnerDigest(env, 'u1', { client: memoryClient })).toBe('written');
    const toolCtx = { db: spied, userId: 'u1', deckId: '', bumpSource: 'x', context: 'general' as const };
    const looked = [await executeSearchMyChats({ query: '银行' }, toolCtx), await executeReadChat({ thread_id: 'th1' }, toolCtx)];
    expect(memorySeen.length).toBe(2);
    expect(JSON.stringify(memorySeen)).not.toContain(SECRET);
    expect(JSON.stringify(looked)).not.toContain(SECRET);
    expect(JSON.stringify(db.rows('SELECT * FROM claude_learner_memory'))).not.toContain(SECRET);

    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).not.toMatch(/student_profiles/i);
  });
});
