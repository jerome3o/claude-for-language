/**
 * "Example sentence style" (shared/study/sentenceStyle.ts): the endpoint against real SQLite with every
 * migration, the generator's learner context reading the note OWNER's style (what the top-ups and the first set
 * use), and the instruction riding in the per-learner user message — never the shared system prompt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import sentenceStyleRoutes from '../../routes/sentence-style';
import { getSentenceStyle } from '../sentence-style';
import { sentenceLearnerContext } from '../sentence-learner-context';
import { buildUserPrompt, generateSentenceSet, SENTENCE_SET_SYSTEM_PROMPT } from '../sentence-set';
import { sentenceStylePrompt } from '../../../../shared/study/sentenceStyle';
import { appendNoteSentences, replaceNoteSentences } from '../../db/queries';
import type { Env } from '../../types';

let db: SqliteD1;
let env: Env;

function put(userId: string, body: unknown) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', sentenceStyleRoutes);
  return app.request('/api/profile/sentence-style', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
}

beforeEach(async () => {
  db = await createSqliteD1();
  env = { DB: db } as unknown as Env;
  for (const u of ['u1', 'u2']) db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [u, `${u}@x.test`, u, 'student']);
  db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'Deck')");
  db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd1', '东西', 'dōngxi', 'thing')");
});

describe('PUT /api/profile/sentence-style', () => {
  it('defaults to everyday, stores a choice and resets with null', async () => {
    expect(await getSentenceStyle(db, 'u1')).toBe('everyday');

    let res = await put('u1', { sentence_style: 'casual' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sentence_style: 'casual', is_default: false });
    expect(await getSentenceStyle(db, 'u1')).toBe('casual');
    expect(await getSentenceStyle(db, 'u2')).toBe('everyday');

    res = await put('u1', { sentence_style: null });
    expect(await res.json()).toEqual({ sentence_style: 'everyday', is_default: true });
    expect(db.rows<{ sentence_style: string | null }>("SELECT sentence_style FROM users WHERE id = 'u1'")[0].sentence_style).toBeNull();
  });

  it('refuses anything else with problems', async () => {
    for (const body of [{}, { sentence_style: 'slang' }, { sentence_style: 2 }]) {
      const res = await put('u1', body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { problems: string[] };
      expect(json.problems.length).toBe(1);
    }
    expect(await getSentenceStyle(db, 'u1')).toBe('everyday');
  });
});

describe('the generator follows the note owner', () => {
  it("reads the owner's style for the note (default everyday)", async () => {
    expect((await sentenceLearnerContext(db, 'n1', '东西')).style).toBe('everyday');
    await put('u1', { sentence_style: 'standard' });
    expect((await sentenceLearnerContext(db, 'n1', '东西')).style).toBe('standard');
    // Someone else's setting never applies to u1's note.
    await put('u2', { sentence_style: 'casual' });
    expect((await sentenceLearnerContext(db, 'n1', '东西')).style).toBe('standard');
  });

  it('records the style a row was written in, kept by replace / append', async () => {
    await replaceNoteSentences(db, 'n1', [
      { hanzi: '这东西挺好的。', pinyin: null, translation: null, audioUrl: null, focus: 'core', focusNote: null, style: 'everyday' },
    ]);
    await appendNoteSentences(db, 'n1', [
      { hanzi: '买东西。', pinyin: null, translation: null, audioUrl: null, focus: 'core', focusNote: null, style: 'casual' },
      { hanzi: '旧东西。', pinyin: null, translation: null, audioUrl: null, focus: 'core', focusNote: null },
    ]);
    expect(db.rows<{ hanzi: string; style: string | null }>("SELECT hanzi, style FROM note_sentences WHERE note_id = 'n1' ORDER BY position")).toEqual([
      { hanzi: '这东西挺好的。', style: 'everyday' },
      { hanzi: '买东西。', style: 'casual' },
      { hanzi: '旧东西。', style: null },
    ]);
  });
});

describe('the prompt per style', () => {
  const input = { hanzi: '东西', pinyin: 'dōngxi', english: 'thing' };

  it('puts the matching instruction in the user message', () => {
    for (const style of ['standard', 'everyday', 'casual'] as const) {
      const prompt = buildUserPrompt({ ...input, style }, 6);
      expect(prompt).toContain(sentenceStylePrompt(style));
      for (const other of ['standard', 'everyday', 'casual'] as const) {
        if (other !== style) expect(prompt).not.toContain(sentenceStylePrompt(other));
      }
    }
    // No style given = the default (everyday).
    expect(buildUserPrompt(input, 6)).toContain(sentenceStylePrompt('everyday'));
  });

  it('keeps the system prompt (and its rules) the same for everyone', () => {
    expect(SENTENCE_SET_SYSTEM_PROMPT).not.toMatch(/REGISTER:/);
    expect(SENTENCE_SET_SYSTEM_PROMPT).toMatch(/natural/);
    expect(SENTENCE_SET_SYSTEM_PROMPT).toMatch(/exactly as written/);
  });

  it('sends it to the model', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'tool_use', id: 't', name: 'create_sentence_set', input: { sentences: [{ hanzi: '这东西挺好的。', pinyin: 'Zhè dōngxi tǐng hǎo de.', translation: "This thing's pretty good.", focus: 'core' }] } }],
          };
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    await generateSentenceSet('k', { ...input, style: 'casual' }, 6, { client, sleep: async () => {} });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].messages)).toContain('REGISTER: casual');
    expect(JSON.stringify(calls[0].system)).not.toContain('REGISTER:');
  });
});
