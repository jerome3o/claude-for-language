/**
 * "🎯 Mini lesson on this mistake" (Sentence Coach): after ✏️ Check my sentence found a mistake,
 * one tap writes a short mini lesson about exactly that mistake — the rule, contrasting examples
 * and a handful of exercises on VARIANTS of the learner's sentence. It is played at once in the
 * lesson player (preview: nothing recorded) and only joins the mini-lesson queue when the learner
 * saves it.
 *
 * Stored on the coach conversation as an assistant message with content_type `mistake_lesson`
 * (content = `MistakeLessonContent` JSON), written in the background by the coach-reply-queue like
 * any coach reply, so reopening the conversation never regenerates it.
 *
 * Shared by the web page, the worker and the Lab app (core/CoachMistakeLesson.kt, parity-tested
 * through android-lab/parity/fixtures/coach.ts).
 */
import type { CustomLessonSpec } from '../lesson/types';

/** coach_messages.content_type of the lesson message. */
export const MISTAKE_LESSON_CONTENT_TYPE = 'mistake_lesson';

/** The quick-action chip under a correction. */
export const COACH_MISTAKE_LESSON_LABEL = '🎯 Mini lesson on this mistake';

/** What the chip says while the lesson is being written. */
export const COACH_MISTAKE_LESSON_BUSY = 'Writing your mini lesson…';

/** The lesson message's content. */
export interface MistakeLessonContent {
  spec: CustomLessonSpec;
  /** The custom lesson made by "Save to my mini lessons" (null = not saved yet). */
  lesson_id?: string | null;
  /** When it was saved (ISO). */
  saved_at?: string | null;
  /** It was saved right after doing it: the completion (with its rating) was recorded too. */
  completed?: boolean;
}

/** The part of a ✏️ Check my sentence result this needs. */
export interface CheckedSentence {
  originalInput: string;
  isCorrect: boolean;
  corrected: { hanzi: string };
}

/** The sentence without spaces and punctuation (so "我去了。" and "我去了" are the same sentence). */
export function sentenceCore(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * Is there a mistake to make a lesson about? Only a Chinese check whose correction differs from
 * what was written (beyond spaces and punctuation); never for a sentence that was already right.
 */
export function coachMistakeLessonOffered(result: CheckedSentence | null | undefined): boolean {
  if (!result || result.isCorrect) return false;
  const wrote = sentenceCore(result.originalInput ?? '');
  const fixed = sentenceCore(result.corrected?.hanzi ?? '');
  return wrote.length > 0 && fixed.length > 0 && wrote !== fixed && /\p{Script=Han}/u.test(wrote);
}

/** How many exercises the lesson has (every section's). */
export function mistakeLessonExerciseCount(spec: Pick<CustomLessonSpec, 'sections'>): number {
  return (spec.sections ?? []).reduce((n, s) => n + (s.exercises?.length ?? 0), 0);
}

/** The lesson card's line in the conversation: "🎯 Mini lesson · 10 exercises". */
export function mistakeLessonCardLine(exercises: number): string {
  return `🎯 Mini lesson · ${exercises} exercise${exercises === 1 ? '' : 's'}`;
}

/** The stored content, or null when it isn't a lesson (old / broken rows). */
export function parseMistakeLessonContent(raw: string | null | undefined): MistakeLessonContent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as MistakeLessonContent;
    if (!v || typeof v !== 'object' || !v.spec || !Array.isArray(v.spec.sections)) return null;
    return { spec: v.spec, lesson_id: v.lesson_id ?? null, saved_at: v.saved_at ?? null, completed: v.completed === true };
  } catch {
    return null;
  }
}
