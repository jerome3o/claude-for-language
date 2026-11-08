/**
 * The write actions of a `card` turn (Ask Claude on a study card): edit / add / delete the card, a mini
 * lesson. Collected by the run loop (`kind: 'write'` / `'lesson'` in tools/registry.ts) and applied
 * here — by the route for the old synchronous `POST /api/notes/:id/ask`, and by the thread runner
 * (thread-turn.ts) one action at a time behind its checkpoint. Moved from routes/ask-claude.ts.
 */
import type { Env, Note } from '../../types';
import * as db from '../../db/queries';
import * as content from '../content';
import { createCustomLessonFromSpec } from '../custom-lesson';
import type { ToolAction } from './types';

export interface AppliedToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** One action on the note the turn is about (never throws: a failure is a result). */
export async function applyCardAction(env: Env, userId: string, note: Note, action: ToolAction, bg?: ExecutionContext): Promise<AppliedToolResult> {
  const id = note.id;
  try {
    switch (action.tool) {
      case 'edit_current_card': {
        const input = action.input as { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string; sentence_clue?: string; sentence_clue_pinyin?: string; sentence_clue_translation?: string };
        const updatedNote = await content.updateNote(env, userId, id, {
          hanzi: input.hanzi || undefined,
          pinyin: input.pinyin || undefined,
          english: input.english || undefined,
          fun_facts: input.fun_facts,
          sentence_clue: input.sentence_clue,
          sentence_clue_pinyin: input.sentence_clue_pinyin,
          sentence_clue_translation: input.sentence_clue_translation,
        }, bg);
        return updatedNote
          ? { tool: 'edit_current_card', success: true, data: { note: updatedNote, changes: input } }
          : { tool: 'edit_current_card', success: false, error: 'Failed to update note' };
      }

      case 'create_flashcards': {
        const input = action.input as { deck_id?: string; flashcards: Array<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> };
        // The target deck: the one asked for when it is the learner's, else the card's.
        const targetDeck = await db.getDeckById(env.DB, input.deck_id || note.deck_id, userId);
        if (!targetDeck) return { tool: 'create_flashcards', success: false, error: 'Target deck not found or not owned by user' };
        const targetDeckId = targetDeck.id;
        const made = await content.createNotes(env, userId, targetDeckId, input.flashcards, bg ? { audio: 'background', bg } : { audio: 'queue' });
        // deck_name: Claude is told on its next turns where the cards went (tool-record.ts).
        return { tool: 'create_flashcards', success: true, data: { created: made.created, count: made.created.length, targetDeckId, deck_name: targetDeck.name } };
      }

      case 'delete_current_card': {
        await content.deleteNote(env, userId, id, bg);
        return { tool: 'delete_current_card', success: true, data: { deletedNoteId: id, reason: (action.input as { reason?: string }).reason || 'Deleted by user request' } };
      }

      case 'create_custom_lesson': {
        const result = await createCustomLessonFromSpec(env, userId, action.input, 'chat');
        return result.ok
          ? { tool: 'create_custom_lesson', success: true, data: { lesson_id: result.lesson.id, title: result.lesson.title, image_jobs: result.imageJobs, ...(result.pinyinFixes.length ? { pinyin_fixes: result.pinyinFixes } : {}) } }
          : { tool: 'create_custom_lesson', success: false, error: `Invalid lesson spec: ${result.errors.join('; ')}` };
      }

      default:
        return { tool: action.tool, success: false, error: 'Unsupported tool' };
    }
  } catch (toolError) {
    console.error(`Tool ${action.tool} error:`, toolError);
    return { tool: action.tool, success: false, error: `Failed to execute ${action.tool}` };
  }
}

/** Every action in order (the synchronous route). */
export async function applyCardActions(env: Env, userId: string, note: Note, actions: readonly ToolAction[], bg?: ExecutionContext): Promise<AppliedToolResult[]> {
  const out: AppliedToolResult[] = [];
  for (const action of actions) out.push(await applyCardAction(env, userId, note, action, bg));
  return out;
}
