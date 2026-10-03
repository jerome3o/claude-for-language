/**
 * update_note — edit one note through `PUT /api/notes/:id` (the content
 * service regenerates clips when the hanzi / sentence changed), then, by
 * default, bring the students' copies of its deck up to date
 * (docs/HOMEWORK.md §10). add_note / batch_add_notes stay in index.ts (they
 * pre-check duplicates in D1) and use the same `updateStudentCopies` helper.
 */
import { z } from 'zod';
import { CARD_STANDARD_SHORT } from '../../../shared/cards/standard';
import type { ToolContext } from './context.js';
import { errorResult, guard, textResult } from './context.js';
import { UPDATE_STUDENT_COPIES, updateStudentCopies } from './student-copies.js';

/** Fields `update_note` may change through PUT /api/notes/:id. */
export const NOTE_PATCH_FIELDS = ['hanzi', 'pinyin', 'english', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation'] as const;

type NotePatch = Partial<Record<(typeof NOTE_PATCH_FIELDS)[number], string>>;

export function registerNoteUpdateTool(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'update_note',
    `Update an existing note. Only the fields given change. A changed hanzi gets a new word clip and a changed sentence_clue a new sentence clip, both generated in the background. When the note's deck was sent to students, their copies can be updated too (only with update_student_copies: true, when the tutor asked; progress kept). ${CARD_STANDARD_SHORT}`,
    {
      note_id: z.string().describe('The note ID'),
      hanzi: z.string().optional().describe('New Chinese characters'),
      pinyin: z.string().optional().describe('New pinyin'),
      english: z.string().optional().describe('New English translation'),
      fun_facts: z.string().optional().describe('Substantive learning note: grammar patterns, cultural context, common mistakes, or disambiguation from similar words'),
      sentence_clue: z.string().optional().describe('A contextual example sentence (in Chinese) that helps disambiguate this word from similar-sounding words'),
      sentence_clue_pinyin: z.string().optional().describe('Pinyin for the sentence clue'),
      sentence_clue_translation: z.string().optional().describe('English translation of the sentence clue'),
      update_student_copies: UPDATE_STUDENT_COPIES,
    },
    async ({ note_id, update_student_copies, ...fields }) =>
      guard(async () => {
        const patch: NotePatch = {};
        for (const key of NOTE_PATCH_FIELDS) {
          const v = (fields as NotePatch)[key];
          if (v !== undefined) patch[key] = v;
        }
        if (Object.keys(patch).length === 0) return errorResult('No updates provided');

        // Ownership is checked by the API (404 when the note isn't the user's).
        const updatedNote = await api.put<{ id: string; deck_id: string } & Record<string, unknown>>(`/api/notes/${encodeURIComponent(note_id)}`, patch);
        const copies = updatedNote.deck_id ? await updateStudentCopies(api, 'deck', updatedNote.deck_id, update_student_copies) : null;

        return textResult(`Updated note: ${JSON.stringify(updatedNote, null, 2)}${copies?.message ? `\n\n${copies.message}` : ''}`);
      })
  );
}
