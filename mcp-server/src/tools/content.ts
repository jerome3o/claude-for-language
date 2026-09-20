/**
 * Content tools for tutors: graded readers (create from a spec, generate,
 * edit, share with a student), the lesson library (create, edit, assign,
 * push updates), decks for students.
 *
 * Every tool calls the main API as the signed-in user (`ctx.api`), so the
 * API's ownership checks, validators and background queues (TTS,
 * illustrations, story generation) apply unchanged. Specs are pre-validated
 * here with the same shared validators so Claude gets the problem list
 * without a round trip. The modules live in ./content/:
 *   readers.ts  — list/get/create/update/generate/retry/delete/export/share
 *   lessons.ts  — lesson library + assignments
 *   decks.ts    — create_deck_for_student, add_words_to_student_deck, get_starter_deck
 *   specs.ts    — spec documentation for descriptions + pure helpers (unit-tested)
 */
import type { ToolContext } from './context.js';
import { registerReaderTools } from './content/readers.js';
import { registerLessonLibraryTools } from './content/lessons.js';
import { registerStudentDeckTools } from './content/decks.js';

export function registerContentTools(ctx: ToolContext): void {
  registerReaderTools(ctx);
  registerLessonLibraryTools(ctx);
  registerStudentDeckTools(ctx);
}
