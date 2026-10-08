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
 *
 * The answer is in simple Chinese unless the account chose English (`users.ask_claude_language`)
 * or the learner explicitly asked for English (`turnLanguage`). A question with Chinese goes
 * through the chat's auto-check in parallel with the answer (`checkAskQuestion`): when it is
 * done within a moment of the answer it comes back with it, else it is stored in the background
 * (`question_check_pending: true` → the client reads the row again).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Note } from '../types';
import * as db from '../db/queries';
import * as content from '../services/content';
import { createCustomLessonFromSpec } from '../services/custom-lesson';
import { askAboutNoteWithTools, type ToolAction } from '../services/ai';
import { parseAskLanguage, turnLanguage } from '@shared/study/askClaude';
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
  setAskLanguage,
  shapeNoteQuestion,
  storeQuestionCheck,
  within,
  type NoteQuestionRow,
} from '../services/ask-claude';

const askClaude = new Hono<{ Bindings: Env }>();

/** How long the answer waits for the question's check once the answer itself is ready. */
export const CHECK_GRACE_MS = 2500;

type ToolResult = { tool: string; success: boolean; data?: Record<string, unknown>; error?: string };

function userIdOf(c: Context<{ Bindings: Env }>): string {
  return (c.get('user' as never) as { id: string }).id;
}

function errorResponse(c: Context<{ Bindings: Env }>, err: unknown): Response {
  if (err instanceof AskClaudeError) return c.json({ error: err.message, retryable: err.status === 503 }, err.status);
  throw err;
}

/** Claude's changes (already approved by being asked for): edit / add / delete the card, a mini lesson. */
async function applyToolActions(c: Context<{ Bindings: Env }>, userId: string, note: Note, actions: ToolAction[]): Promise<ToolResult[]> {
  const id = note.id;
  const toolResults: ToolResult[] = [];
  for (const action of actions) {
    try {
      switch (action.tool) {
        case 'edit_current_card': {
          const input = action.input as { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string; sentence_clue?: string; sentence_clue_pinyin?: string; sentence_clue_translation?: string };
          const updatedNote = await content.updateNote(c.env, userId, id, {
            hanzi: input.hanzi || undefined,
            pinyin: input.pinyin || undefined,
            english: input.english || undefined,
            fun_facts: input.fun_facts,
            sentence_clue: input.sentence_clue,
            sentence_clue_pinyin: input.sentence_clue_pinyin,
            sentence_clue_translation: input.sentence_clue_translation,
          }, c.executionCtx);
          if (updatedNote) {
            toolResults.push({ tool: 'edit_current_card', success: true, data: { note: updatedNote, changes: input } });
          } else {
            toolResults.push({ tool: 'edit_current_card', success: false, error: 'Failed to update note' });
          }
          break;
        }

        case 'create_flashcards': {
          const input = action.input as { deck_id?: string; flashcards: Array<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> };
          // Determine target deck — use provided deck_id if valid, otherwise current deck
          let targetDeckId = note.deck_id;
          if (input.deck_id && input.deck_id !== note.deck_id) {
            const targetDeck = await db.getDeckById(c.env.DB, input.deck_id, userId);
            if (targetDeck) {
              targetDeckId = input.deck_id;
            } else {
              toolResults.push({ tool: 'create_flashcards', success: false, error: 'Target deck not found or not owned by user' });
              break;
            }
          }
          const made = await content.createNotes(c.env, userId, targetDeckId, input.flashcards, { audio: 'background', bg: c.executionCtx });
          toolResults.push({ tool: 'create_flashcards', success: true, data: { created: made.created, count: made.created.length, targetDeckId } });
          break;
        }

        case 'delete_current_card': {
          await content.deleteNote(c.env, userId, id, c.executionCtx);
          toolResults.push({
            tool: 'delete_current_card',
            success: true,
            data: { deletedNoteId: id, reason: (action.input as { reason?: string }).reason || 'Deleted by user request' },
          });
          break;
        }

        case 'create_custom_lesson': {
          const result = await createCustomLessonFromSpec(c.env, userId, action.input, 'chat');
          if (result.ok) {
            toolResults.push({ tool: 'create_custom_lesson', success: true, data: { lesson_id: result.lesson.id, title: result.lesson.title, image_jobs: result.imageJobs } });
          } else {
            toolResults.push({ tool: 'create_custom_lesson', success: false, error: `Invalid lesson spec: ${result.errors.join('; ')}` });
          }
          break;
        }
      }
    } catch (toolError) {
      console.error(`Tool ${action.tool} error:`, toolError);
      toolResults.push({ tool: action.tool, success: false, error: `Failed to execute ${action.tool}` });
    }
  }
  return toolResults;
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
    }>()
    .catch(() => ({} as Record<string, never>));
  const question = typeof body.question === 'string' ? body.question : '';
  if (!question.trim()) return c.json({ error: 'question is required' }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 500);

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) return c.json({ error: 'Note not found' }, 404);

  const settings = await askSettings(c.env.DB, userId);
  // The app's current choice (the sheet's 中 / EN), else the account's; an explicit "in English" wins.
  const language = turnLanguage(parseAskLanguage(body.language) ?? settings.language, question);
  const history = Array.isArray(body.conversationHistory) ? body.conversationHistory : undefined;

  // The learner's own Chinese goes through the chat's auto-check, beside the answer.
  const checking: Promise<AutoCheckResult | null> | null = body.quick
    ? null
    : checkAskQuestion(c.env, settings.autoCheck, question, askCheckContext(note, history));

  try {
    const { answer, toolActions, readOnlyToolCalls } = await askAboutNoteWithTools(
      c.env.ANTHROPIC_API_KEY, note, question, body.context, history,
      { db: c.env.DB, userId, deckId: note.deck_id },
      { language },
    );

    const toolResults = await applyToolActions(c, userId, note, toolActions);
    const created = await db.createNoteQuestion(c.env.DB, id, question, answer, language);
    const row = created as unknown as NoteQuestionRow;

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

export default askClaude;
