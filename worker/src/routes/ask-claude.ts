/**
 * Ask Claude on the study card (docs/STUDY_SESSION.md "Ask Claude"). Mounted under /api in
 * index.ts after the auth middleware.
 *
 *   POST /notes/:id/ask                    { question, context?, conversationHistory?, language?: 'zh'|'en', quick? }
 *                                          → 201 the Q&A (+ toolResults, readOnlyToolCalls, question_check_pending)
 *   GET  /note-questions/:id               one Q&A (shaped: words, translations, the question's check)
 *   POST /note-questions/:id/words         { part: 'answer'|'question' } → { words | null, cached }
 *   POST /note-questions/:id/translate     { part } → { translation, cached }
 *   PUT  /profile/ask-claude-language      { ask_claude_language: 'zh'|'en'|null } → { ask_claude_language }
 *   PUT  /profile/ask-claude-listening     { ask_claude_listening: boolean } → { ask_claude_listening }
 *
 * The answer is in simple Chinese unless the account chose English (`users.ask_claude_language`)
 * or the learner explicitly asked for English (`turnLanguage`). A question with Chinese goes
 * through the chat's auto-check in parallel with the answer (`checkAskQuestion`): when it is
 * done within a moment of the answer (CHECK_GRACE_MS) it comes back with it, else it is stored in
 * the background (`question_check_pending: true` → the client reads the row again).
 *
 * 🎧 Listen first (`users.ask_claude_listening`, or the request's `listening`): a Chinese answer's
 * read-aloud clip is made in the background (`waitUntil`) — the answer never waits for it
 * (`answer_clip_ready: false`). A tap before it is done plays through `/api/practice/tts` with the
 * same text, voice and speed, which makes (or finds) the same clip.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import * as db from '../db/queries';
import { askTurns, runClaudeTurn } from '../services/claude-agent';
import { applyCardActions } from '../services/claude-agent/apply';
import { appendCardQuestion } from '../services/claude-agent/backfill';
import { rememberThread } from '../services/claude-agent/memory';
import { parseAskLanguage, turnLanguage } from '@shared/study/askClaude';
import { cachedConversationTTS } from '../services/tts-cache';
import type { AutoCheckResult } from '@shared/chats/autoCheck';
import {
  AskClaudeError,
  askCheckContext,
  askSettings,
  checkAskQuestion,
  ensureAskTranslation,
  ensureAskWords,
  loadOwnedQuestion,
  parsePart,
  pregenerateAskClip,
  setAskLanguage,
  setAskListening,
  shapeNoteQuestion,
  storeQuestionCheck,
  within,
  type NoteQuestionRow,
} from '../services/ask-claude';

const askClaude = new Hono<{ Bindings: Env }>();

/**
 * How long the answer waits for the question's check once the answer itself is ready (the check
 * started with the answer, so it is usually done; otherwise both apps poll the row for it).
 */
export const CHECK_GRACE_MS = 800;

function userIdOf(c: Context<{ Bindings: Env }>): string {
  return (c.get('user' as never) as { id: string }).id;
}

function errorResponse(c: Context<{ Bindings: Env }>, err: unknown): Response {
  if (err instanceof AskClaudeError) return c.json({ error: err.message, retryable: err.status === 503 }, err.status);
  throw err;
}

askClaude.post('/notes/:id/ask', async (c) => {
  const userId = userIdOf(c);
  const id = c.req.param('id');
  const body = await c.req
    .json<{
      question?: string;
      context?: { userAnswer?: string; correctAnswer?: string; cardType?: string };
      conversationHistory?: { question: string; answer: string }[];
      language?: unknown;
      /** A quick-question chip: the app wrote it, so it isn't checked. */
      quick?: boolean;
      /** The sheet's 🎧 (else the account's): make the answer's clip before answering. */
      listening?: unknown;
    }>()
    .catch(() => ({} as Record<string, never>));
  const question = typeof body.question === 'string' ? body.question : '';
  if (!question.trim()) return c.json({ error: 'question is required' }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 500);

  const [note, settings] = await Promise.all([db.getNoteById(c.env.DB, id, userId), askSettings(c.env.DB, userId)]);
  if (!note) return c.json({ error: 'Note not found' }, 404);

  // The app's current choice (the sheet's 中 / EN), else the account's; an explicit "in English" wins.
  const language = turnLanguage(parseAskLanguage(body.language) ?? settings.language, question);
  const history = Array.isArray(body.conversationHistory) ? body.conversationHistory : undefined;

  // The learner's own Chinese goes through the chat's auto-check, beside the answer.
  const checking: Promise<AutoCheckResult | null> | null = body.quick
    ? null
    : checkAskQuestion(c.env, settings.autoCheck, question, askCheckContext(note, history));

  try {
    // A `card` turn of the Claude agent harness (services/claude-agent/contexts/card.ts).
    const typed = body.context?.userAnswer ? { answer: body.context.userAnswer, correct: body.context.correctAnswer } : undefined;
    const { answer, toolActions, readOnlyToolCalls } = await runClaudeTurn(
      c.env,
      { kind: 'card', note_id: note.id, note, ...(typed ? { typed } : {}) },
      { userId, language, turns: askTurns(question, history) },
    );

    // Claude's changes (already approved by being asked for): edit / add / delete the card, a mini lesson.
    const toolResults = await applyCardActions(c.env, userId, note, toolActions, c.executionCtx);
    const created = await db.createNoteQuestion(c.env.DB, id, question, answer, language);
    const row = created as unknown as NoteQuestionRow;
    // The same Q&A in the card's Claude thread (docs/CHAT.md "Claude threads"; older apps keep this route).
    c.executionCtx.waitUntil(
      appendCardQuestion(c.env.DB, userId, note, row)
        // Claude memory: the card thread's summary once the Q&A is in it (never in the answer's way).
        .then((threadId) => (threadId ? rememberThread(c.env, threadId) : undefined))
        .catch((err) => console.error('[ask] thread dual-write failed', row.id, err instanceof Error ? err.message : err)),
    );

    // 🎧 Listen first: the answer's clip, made in the background — never waited for.
    const listening = typeof body.listening === 'boolean' ? body.listening : settings.listening;
    if (listening) {
      c.executionCtx.waitUntil(
        pregenerateAskClip(c.env, row, (env, text, v) => cachedConversationTTS(env, text, { voiceId: v.voiceId, speed: v.speed, priority: 'interactive' })).catch(() => undefined),
      );
    }

    let pending = false;
    if (checking) {
      const r = await within(checking, CHECK_GRACE_MS);
      if (r.done) {
        if (r.value) {
          await storeQuestionCheck(c.env.DB, row.id, r.value);
          row.question_check = JSON.stringify(r.value);
        }
      } else {
        pending = true;
        c.executionCtx.waitUntil(checking.then((v) => (v ? storeQuestionCheck(c.env.DB, row.id, v) : undefined)).catch(() => undefined));
      }
    }

    return c.json({
      ...shapeNoteQuestion(row),
      question_check_pending: pending,
      answer_clip_ready: false,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      readOnlyToolCalls: readOnlyToolCalls.length > 0 ? readOnlyToolCalls : undefined,
    }, 201);
  } catch (error) {
    console.error('AI ask error:', error);
    return c.json({ error: 'Failed to get answer from AI' }, 500);
  }
});

askClaude.get('/note-questions/:id', async (c) => {
  try {
    return c.json(shapeNoteQuestion(await loadOwnedQuestion(c.env.DB, c.req.param('id'), userIdOf(c))));
  } catch (err) {
    return errorResponse(c, err);
  }
});

askClaude.post('/note-questions/:id/words', async (c) => {
  const body = await c.req.json<{ part?: unknown }>().catch(() => ({} as { part?: unknown }));
  try {
    return c.json(await ensureAskWords(c.env, c.req.param('id'), userIdOf(c), parsePart(body.part ?? 'answer')));
  } catch (err) {
    return errorResponse(c, err);
  }
});

askClaude.post('/note-questions/:id/translate', async (c) => {
  const body = await c.req.json<{ part?: unknown }>().catch(() => ({} as { part?: unknown }));
  try {
    return c.json(await ensureAskTranslation(c.env, c.req.param('id'), userIdOf(c), parsePart(body.part ?? 'answer')));
  } catch (err) {
    return errorResponse(c, err);
  }
});

askClaude.put('/profile/ask-claude-language', async (c) => {
  const body = await c.req.json<{ ask_claude_language?: unknown }>().catch(() => ({} as { ask_claude_language?: unknown }));
  const v = body.ask_claude_language;
  if (v !== null && parseAskLanguage(v) === null) return c.json({ error: "ask_claude_language must be 'zh', 'en' or null" }, 400);
  const language = v === null ? null : parseAskLanguage(v);
  await setAskLanguage(c.env.DB, userIdOf(c), language);
  return c.json({ ask_claude_language: language });
});

askClaude.put('/profile/ask-claude-listening', async (c) => {
  const body = await c.req.json<{ ask_claude_listening?: unknown }>().catch(() => ({} as { ask_claude_listening?: unknown }));
  const v = body.ask_claude_listening;
  if (typeof v !== 'boolean') return c.json({ error: 'ask_claude_listening must be true or false' }, 400);
  await setAskListening(c.env.DB, userIdOf(c), v);
  return c.json({ ask_claude_listening: v });
});

export default askClaude;
