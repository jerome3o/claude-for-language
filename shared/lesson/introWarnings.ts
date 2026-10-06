/**
 * Soft check for spoiler intros (LESSON_AUTHORING_RULES "SPOILER-FREE
 * INTROS"): a note placed BEFORE a conversation that quotes the dialogue
 * gives the listening exercise away. Warnings only — the lesson is saved;
 * authoring Claudes get them back to fix, the editor shows them.
 */
import type { CustomLessonSpec, ConversationExerciseSpec, LessonExercise } from './types';

/** Han characters + digits only, so punctuation / spacing differences don't hide a quote. */
function core(s: string): string {
  return (s.match(/[\p{Script=Han}0-9]/gu) ?? []).join('');
}

/** Shortest stretch of a line that counts as quoting it (a proper noun alone is fine). */
export const QUOTE_MIN_CHARS = 6;

function quotedStretch(line: string, note: string): string | null {
  const l = core(line);
  if (l.length < 4) return null;
  if (l.length < QUOTE_MIN_CHARS) return note.includes(l) ? l : null;
  for (let i = 0; i + QUOTE_MIN_CHARS <= l.length; i++) {
    const w = l.slice(i, i + QUOTE_MIN_CHARS);
    if (note.includes(w)) {
      // Grow the match for a readable warning.
      let end = i + QUOTE_MIN_CHARS;
      while (end < l.length && note.includes(l.slice(i, end + 1))) end++;
      return l.slice(i, end);
    }
  }
  return null;
}

function noteText(ex: LessonExercise): string {
  if (ex.type !== 'note') return '';
  return core([ex.title ?? '', ex.body ?? '', ...(ex.sentences ?? []).map((s) => s.hanzi)].join(' '));
}

/** Warnings for notes that come before a conversation and quote its lines. */
export function conversationIntroWarnings(spec: CustomLessonSpec): string[] {
  const warnings: string[] = [];
  const notes: Array<{ where: string; text: string }> = [];
  spec.sections.forEach((section, si) => {
    section.exercises.forEach((ex, ei) => {
      const where = `sections[${si}].exercises[${ei}]`;
      if (ex.type === 'note') {
        notes.push({ where, text: noteText(ex) });
        return;
      }
      if (ex.type !== 'conversation') return;
      const convo = ex as ConversationExerciseSpec;
      for (const note of notes) {
        const quotes = convo.lines.map((l) => quotedStretch(l.hanzi, note.text)).filter((q): q is string => !!q);
        if (quotes.length) {
          warnings.push(
            `${note.where}: this note comes before the conversation at ${where} and quotes its dialogue (${quotes.slice(0, 3).map((q) => `“${q}”`).join(', ')}) — that gives the listening away. Keep the intro to one scene-setting sentence plus proper nouns / hard nouns, and move phrases into a note after the conversation.`,
          );
        }
      }
    });
  });
  return warnings;
}
