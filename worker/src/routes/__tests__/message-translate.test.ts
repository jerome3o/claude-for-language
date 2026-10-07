/**
 * Translate in the chat's message menu (routes/message-translate.ts) against real
 * SQLite: fast translation cached for both people, access, readable retryable
 * failures, and the word-by-word route surviving a failed breakdown.
 * Claude is faked below `structuredCall` (the real retry / validate logic runs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import messageTranslate from '../message-translate';
import type { Env } from '../../types';

const ai = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../services/structured-call', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/structured-call')>();
  return {
    ...mod,
    structuredCall: (opts: Parameters<typeof mod.structuredCall>[0]) =>
      mod.structuredCall({ ...opts, client: { messages: { create: ai.create } } as never, sleep: async () => {} }),
  };
});

type CreateParams = { tool_choice: { name: string }; max_tokens: number };
const toolReply = (input: unknown, stop_reason = 'tool_use') => ({
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [{ type: 'tool_use', id: 't', name: 'x', input }],
});

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const LONG = '明天我们上课的时候先复习一下上次学的生词，然后我会给你讲一个新的语法点，就是“把”字句。'.repeat(3);

let db: SqliteD1;

function seed() {
  for (const [id, name] of [[TUTOR, 'Minghui'], [STUDENT, 'Jerome'], ['stranger', 'Nobody']]) {
    db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@x.test`, name, 'student']);
  }
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'tutor', 'active')", [TUTOR, STUDENT]);
  db.raw.run("INSERT INTO conversations (id, relationship_id, title) VALUES ('conv-1', 'rel-1', 'Chat')");
  db.raw.run("INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES ('m-long', 'conv-1', ?, ?, '2026-10-07T06:39:00Z')", [TUTOR, LONG]);
}

function as(userId: string, env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', messageTranslate);
  const fullEnv = { DB: db, ANTHROPIC_API_KEY: 'test-key', ...env } as unknown as Env;
  return (path: string) => app.request(path, { method: 'POST' }, fullEnv);
}

const stored = () => db.rows<{ translation: string | null; segmentation: string | null }>("SELECT translation, segmentation FROM messages WHERE id = 'm-long'")[0];

beforeEach(async () => {
  db = await createSqliteD1();
  seed();
  ai.create.mockReset();
});

describe('POST /api/messages/:id/translate', () => {
  it('translates a long message with ONE short call and stores it for both people', async () => {
    ai.create.mockImplementation(async (p: CreateParams) => {
      expect(p.tool_choice.name).toBe('give_translation');
      return toolReply({ translation: 'In class tomorrow we will first review…' });
    });
    const res = await as(STUDENT)('/api/messages/m-long/translate');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ translation: 'In class tomorrow we will first review…' });
    expect(ai.create).toHaveBeenCalledTimes(1);
    expect(stored().translation).toBe('In class tomorrow we will first review…');

    // The tutor (or a second tap) gets the stored one, no model call.
    const again = await as(TUTOR)('/api/messages/m-long/translate');
    expect(await again.json()).toEqual({ translation: 'In class tomorrow we will first review…' });
    expect(ai.create).toHaveBeenCalledTimes(1);
  });

  it('answers 503 retryable with a readable reason when Claude fails (never a raw parser error)', async () => {
    ai.create.mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
    const res = await as(STUDENT)('/api/messages/m-long/translate');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; retryable: boolean };
    expect(body.retryable).toBe(true);
    expect(body.error).not.toMatch(/JSON/);
    expect(stored().translation).toBeNull();
  });

  it('refuses someone outside the chat and a missing message', async () => {
    expect((await as('stranger')('/api/messages/m-long/translate')).status).toBe(403);
    expect((await as(STUDENT)('/api/messages/nope/translate')).status).toBe(404);
    expect(ai.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/messages/:id/translate-segmented', () => {
  it('returns the translation even when the breakdown is cut off twice, and leaves segmentation for later', async () => {
    ai.create.mockImplementation(async (p: CreateParams) =>
      p.tool_choice.name === 'give_translation' ? toolReply({ translation: 'Tomorrow…' }) : toolReply({}, 'max_tokens'),
    );
    const res = await as(STUDENT)('/api/messages/m-long/translate-segmented');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { translation: string; segmentation: { chunks: unknown[]; english: string } };
    expect(body.translation).toBe('Tomorrow…');
    expect(body.segmentation).toMatchObject({ english: 'Tomorrow…', chunks: [] });
    expect(stored()).toEqual({ translation: 'Tomorrow…', segmentation: null });
  });

  it('stores a real breakdown and serves it from the row next time', async () => {
    db.raw.run("UPDATE messages SET translation = 'Stored EN' WHERE id = 'm-long'");
    ai.create.mockImplementation(async () => toolReply({ english: 'Tomorrow', chunks: [{ hanzi: '明天', pinyin: 'míngtiān', english: 'Tomorrow' }] }));
    const first = (await (await as(STUDENT)('/api/messages/m-long/translate-segmented')).json()) as { translation: string };
    expect(first.translation).toBe('Stored EN');
    expect(ai.create).toHaveBeenCalledTimes(1); // the stored translation is reused
    expect(JSON.parse(stored().segmentation!).chunks).toHaveLength(1);
    await as(TUTOR)('/api/messages/m-long/translate-segmented');
    expect(ai.create).toHaveBeenCalledTimes(1);
  });
});
