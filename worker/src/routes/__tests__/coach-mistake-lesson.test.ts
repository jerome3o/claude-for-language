/**
 * "🎯 Mini lesson on this mistake" (Sentence Coach, services/mistake-lesson.ts) against real SQLite
 * with every migration: the lesson is written in the background like a coach reply and stored on
 * the conversation (asking again never writes a second one), only offered for a real mistake, a
 * pending lesson doesn't hold up the chat, Save makes ONE custom lesson (source 'coach') and records
 * the completion when he just did it, and the writer validates + repairs. The model is a mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import coachRoutes from '../coach';
import { runCoachReply, buildCoachHistory, type CoachMistakeLessonFn } from '../../services/coach-replies';
import { generateMistakeLessonSpec, mistakeLessonBrief, mistakeLessonProblems, fakeMistakeLessonSpec, MISTAKE_LESSON_SYSTEM } from '../../services/mistake-lesson';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import type { CoachMessage, Env } from '../../types';

const USER = 'user-1';
const SENTENCE = '我昨天去了商店买东西了';
const FIXED = { hanzi: '我昨天去商店买东西了', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went shopping yesterday.' };
const WRONG = { kind: 'chinese', coach: { originalInput: SENTENCE, inputLanguage: 'chinese', isCorrect: false, corrected: FIXED, critique: 'One 了 is enough: at the end.', issues: [], alternatives: [], vocabSuggestions: [] } };
const RIGHT = { kind: 'chinese', coach: { ...WRONG.coach, originalInput: FIXED.hanzi, isCorrect: true, critique: 'Perfect.' } };

/** A lesson that passes validateLessonSpec and the shape checks. */
export const GOOD_SPEC: CustomLessonSpec = {
  title: 'One 了 at the end',
  icon: '🎯',
  description: 'Where 了 goes when the action is done.',
  sections: [
    { title: 'Your mistake', exercises: [{ type: 'note', title: 'One 了 is enough', body: `You wrote: ${SENTENCE} ✗\nA native says: ${FIXED.hanzi} ✓`, sentences: [FIXED, { hanzi: '他昨天去银行了。', pinyin: 'tā zuótiān qù yínháng le.', english: 'He went to the bank yesterday.' }] }] },
    {
      title: 'Practise it',
      exercises: [
        { type: 'choice', question: 'Which sentence is correct?', options: [{ hanzi: '他昨天去银行了。' }, { hanzi: '他昨天去了银行了。' }], correct: 0, explanation: 'One 了.' },
        { type: 'choice', question: 'Which one?', options: [{ hanzi: '我买了书。' }, { hanzi: '我买了书了了。' }], correct: 0 },
        { type: 'scramble', english: 'He went to the bank yesterday.', tiles: ['去银行', '他', '了', '昨天'], correct_order: ['他', '昨天', '去银行', '了'] },
        { type: 'scramble', english: 'I went to the shop.', tiles: ['了', '我', '去商店'], correct_order: ['我', '去商店', '了'] },
      ],
    },
    {
      title: 'Use it',
      exercises: [
        { type: 'translate', english: 'She went to the shop yesterday.', reference_hanzi: '她昨天去商店了。', reference_pinyin: 'tā zuótiān qù shāngdiàn le.' },
        { type: 'translate', english: 'We went to the bank.', reference_hanzi: '我们去银行了。', reference_pinyin: 'wǒmen qù yínháng le.' },
        { type: 'write_typed', answer: FIXED },
        { type: 'sentence_making', words: [{ hanzi: '了', pinyin: 'le' }], task: 'Say what you did yesterday.', example: { hanzi: '我昨天去银行了。', pinyin: 'wǒ zuótiān qù yínháng le.', english: 'I went to the bank yesterday.' } },
      ],
    },
  ],
};

function seed(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES (?, 'u@x.test', 'Jerome', 'student')", [USER]);
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('other', 'o@x.test', 'Other', 'student')");
}

function makeWorld(db: SqliteD1) {
  const sent: Array<{ messageId: string }> = [];
  const env = { DB: db, ANTHROPIC_API_KEY: 'test-key', COACH_REPLY_QUEUE: { send: async (m: { messageId: string }) => { sent.push(m); } } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => { c.set('user', { id: c.req.header('x-user') ?? USER } as never); await next(); });
  app.route('/api', coachRoutes);
  const call = (method: string, path: string, body?: unknown, user?: string) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { env, sent, call };
}

const json = async <T,>(res: Response) => (await res.json()) as T;
type ConvBody = { conversation: { id: string }; messages: CoachMessage[]; existing?: boolean };

describe('coach mistake lessons', () => {
  let db: SqliteD1;
  let w: ReturnType<typeof makeWorld>;

  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
    w = makeWorld(db);
  });

  async function checked(analysis: unknown = WRONG, text = SENTENCE) {
    const res = await w.call('POST', '/api/coach/conversations', { text, action: 'check', background: true });
    const body = await json<ConvBody>(res);
    expect(await runCoachReply(w.env, w.sent.at(-1)!.messageId, { analyse: async () => analysis as never })).toBe('done');
    return body.conversation.id;
  }

  const writer = (spec: CustomLessonSpec = GOOD_SPEC) => vi.fn<CoachMistakeLessonFn>(async () => ({ spec, lesson_id: null, saved_at: null, completed: false }));

  it('writes the lesson in the background and stores it on the conversation; asking again returns it', async () => {
    const id = await checked();
    const res = await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`);
    expect(res.status).toBe(202);
    const body = await json<ConvBody>(res);
    expect(body.messages.map((m) => [m.role, m.content_type, m.status])).toEqual([['assistant', 'mistake_lesson', 'pending']]);

    // Asking while it is being written: the same message, nothing queued again.
    const queued = w.sent.length;
    const again = await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`);
    expect(again.status).toBe(200);
    expect((await json<ConvBody>(again)).messages[0].id).toBe(body.messages[0].id);
    expect(w.sent.length).toBe(queued);

    // A follow-up is not held up by the lesson.
    expect((await w.call('POST', `/api/coach/conversations/${id}/messages`, { message: 'Why?', background: true })).status).toBe(202);

    const write = writer();
    expect(await runCoachReply(w.env, body.messages[0].id, { mistakeLesson: write })).toBe('done');
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ original: SENTENCE, coach: expect.objectContaining({ corrected: FIXED, critique: 'One 了 is enough: at the end.' }) }), USER);

    const conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    const lesson = conv.messages.find((m) => m.content_type === 'mistake_lesson')!;
    expect(lesson.status).toBeNull();
    expect(JSON.parse(lesson.content)).toMatchObject({ spec: { title: 'One 了 at the end' }, lesson_id: null });

    // Reopening never regenerates it.
    const third = await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`);
    expect(third.status).toBe(200);
    expect((await json<ConvBody>(third)).existing).toBe(true);

    // The chat history knows about it, as a line (not the spec).
    const history = buildCoachHistory(conv.messages, 'none');
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant', 'user', 'assistant'].slice(0, history.length));
    expect(history.some((h) => h.content.includes('mini lesson on this mistake') && h.content.includes('One 了 at the end'))).toBe(true);
  });

  it('is refused when the sentence was already right, or the conversation is someone else\'s', async () => {
    const id = await checked(RIGHT, FIXED.hanzi);
    expect((await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`)).status).toBe(400);
    const mine = await checked();
    expect((await w.call('POST', `/api/coach/conversations/${mine}/mistake-lesson`, undefined, 'other')).status).toBe(404);
  });

  it('a failed lesson says so and asking again re-queues the same message', async () => {
    const id = await checked();
    const { messages: [pending] } = await json<ConvBody>(await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`));
    const { StructuredCallError } = await import('../../services/structured-call');
    expect(await runCoachReply(w.env, pending.id, { mistakeLesson: async () => { throw new StructuredCallError('nope', false); } })).toBe('failed');
    let conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.find((m) => m.id === pending.id)).toMatchObject({ status: 'failed', error: 'Claude couldn’t write a lesson for this one — try again.' });

    const res = await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`);
    expect(res.status).toBe(202);
    expect((await json<ConvBody>(res)).messages[0]).toMatchObject({ id: pending.id, status: 'pending' });
    expect(w.sent.at(-1)!.messageId).toBe(pending.id);
    expect(await runCoachReply(w.env, pending.id, { mistakeLesson: writer() })).toBe('done');
    conv = await json<ConvBody>(await w.call('GET', `/api/coach/conversations/${id}`));
    expect(conv.messages.filter((m) => m.content_type === 'mistake_lesson')).toHaveLength(1);
  });

  it('Save makes ONE custom lesson (source coach) and records the completion when he just did it', async () => {
    const id = await checked();
    const { messages: [pending] } = await json<ConvBody>(await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`));
    // Not ready yet: nothing to save.
    expect((await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, {})).status).toBe(409);
    await runCoachReply(w.env, pending.id, { mistakeLesson: writer() });

    // A bad completion is refused before anything is made.
    expect((await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, { completion: { id: 'e1', correct: 3, total: 5, rating: 7 } })).status).toBe(400);

    const completion = { id: 'evt-1', correct: 6, total: 8, rating: 2, completed_at: '2026-10-13T09:00:00.000Z', attempt: { started_at: '2026-10-13T08:55:00.000Z', duration_ms: 300000, exercises: [] } };
    const res = await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, { completion });
    expect(res.status).toBe(200);
    const saved = await json<{ lesson_id: string; title: string; completed: boolean; message: CoachMessage }>(res);
    expect(saved).toMatchObject({ title: 'One 了 at the end', completed: true });
    expect(JSON.parse(saved.message.content)).toMatchObject({ lesson_id: saved.lesson_id, completed: true });

    const row = db.rows<{ source: string; user_id: string }>('SELECT source, user_id FROM custom_lessons WHERE id = ?', [saved.lesson_id])[0];
    expect(row).toEqual({ source: 'coach', user_id: USER });
    expect(db.rows('SELECT id, rating, correct, total FROM custom_lesson_completions WHERE lesson_id = ?', [saved.lesson_id])).toEqual([{ id: 'evt-1', rating: 2, correct: 6, total: 8 }]);

    // Saving again (a double tap, the other device): the same lesson, the completion not doubled.
    const twice = await json<{ lesson_id: string }>(await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, { completion }));
    expect(twice.lesson_id).toBe(saved.lesson_id);
    expect(db.rows('SELECT id FROM custom_lessons WHERE user_id = ?', [USER])).toHaveLength(1);
    expect(db.rows('SELECT id FROM custom_lesson_completions')).toHaveLength(1);
  });

  it('Save without doing it: a NEW lesson in the queue (no completion)', async () => {
    const id = await checked();
    const { messages: [pending] } = await json<ConvBody>(await w.call('POST', `/api/coach/conversations/${id}/mistake-lesson`));
    await runCoachReply(w.env, pending.id, { mistakeLesson: writer() });
    const saved = await json<{ lesson_id: string; completed: boolean }>(await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, {}));
    expect(saved.completed).toBe(false);
    expect(db.rows('SELECT id FROM custom_lesson_completions')).toHaveLength(0);
    // Deleted from Mini Lessons since: Save makes it again.
    db.raw.run('DELETE FROM custom_lessons WHERE id = ?', [saved.lesson_id]);
    const again = await json<{ lesson_id: string }>(await w.call('POST', `/api/coach/conversations/${id}/messages/${pending.id}/save-lesson`, {}));
    expect(again.lesson_id).not.toBe(saved.lesson_id);
  });
});

describe('the mistake-lesson writer', () => {
  const input = { original: SENTENCE, coach: WRONG.coach };

  function reply(spec: unknown, id = 'tu1'): Anthropic.Message {
    return { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id, name: 'create_lesson_spec', input: spec }] } as unknown as Anthropic.Message;
  }

  it('forces the tool with thinking off and sends the sentence, correction and critique', async () => {
    const create = vi.fn(async (_p: Anthropic.MessageCreateParamsNonStreaming) => reply(structuredClone(GOOD_SPEC)));
    const { spec, rounds } = await generateMistakeLessonSpec(input, create);
    expect(rounds).toBe(1);
    expect(spec.title).toBe('One 了 at the end');
    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'create_lesson_spec' });
    expect(params.system).toBe(MISTAKE_LESSON_SYSTEM);
    const user = params.messages[0].content as string;
    expect(user).toContain(SENTENCE);
    expect(user).toContain(FIXED.hanzi);
    expect(user).toContain('One 了 is enough');
  });

  it('repairs an invalid spec, then a lesson of the wrong shape', async () => {
    const broken = { ...structuredClone(GOOD_SPEC), sections: [{ exercises: [{ type: 'scramble', english: 'x', tiles: ['a'], correct_order: ['b'] }] }] };
    const thin = { ...structuredClone(GOOD_SPEC), sections: [GOOD_SPEC.sections[0], { exercises: [GOOD_SPEC.sections[1].exercises[0]] }] };
    const create = vi.fn()
      .mockResolvedValueOnce(reply(broken, 'a'))
      .mockResolvedValueOnce(reply(thin, 'b'))
      .mockResolvedValueOnce(reply(structuredClone(GOOD_SPEC), 'c'));
    const { rounds } = await generateMistakeLessonSpec(input, create);
    expect(rounds).toBe(3);
    const second = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming;
    const feedback = JSON.stringify(second.messages.at(-1));
    expect(feedback).toContain('Not right yet');
    const third = JSON.stringify((create.mock.calls[2][0] as Anthropic.MessageCreateParamsNonStreaming).messages.at(-1));
    expect(third).toContain('exercises after the note');
  });

  it('gives up (not retried) when it never validates', async () => {
    const broken = { title: 'x', sections: [] };
    const create = vi.fn(async () => reply(broken));
    await expect(generateMistakeLessonSpec(input, create)).rejects.toMatchObject({ retryable: false });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('shape checks, brief and the E2E stand-in', () => {
    expect(mistakeLessonProblems(GOOD_SPEC)).toEqual([]);
    const withConversation = { ...GOOD_SPEC, sections: [...GOOD_SPEC.sections, { exercises: [{ type: 'conversation' }] }] } as unknown as CustomLessonSpec;
    expect(mistakeLessonProblems(withConversation).join(' ')).toContain('"conversation"');
    expect(mistakeLessonProblems({ ...GOOD_SPEC, sections: GOOD_SPEC.sections.slice(1) }).join(' ')).toContain('start with ONE "note"');
    expect(mistakeLessonBrief({ original: SENTENCE, coach: { ...WRONG.coach, issues: [{ type: 'grammar', original: '去了', suggestion: '去', explanation: 'one 了' }] } as never })).toContain('去了 → 去: one 了');
    expect(validateLessonSpec(fakeMistakeLessonSpec(input))).toEqual([]);
  });
});
