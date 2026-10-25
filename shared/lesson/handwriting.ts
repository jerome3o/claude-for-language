/**
 * "Skip handwriting exercises" (Settings → Study; docs/STUDY_SESSION.md "Skip handwriting").
 *
 * Jerome (Oct 2026): "it's teaching me how to write characters, and I don't actually want to write
 * characters". With the account switch on (`users.skip_handwriting`, on /api/auth/me and
 * /api/sync/changes, cached on the device):
 *  - `write_handwriting` exercises are left out of every run (`lessonSteps(…, { skipHandwriting })`
 *    in shared/study/lessonRun.ts) — never shown, never scored, never missed, so they never make a
 *    revision; a lesson's earlier misses on them stop counting too (`handwritingKeys` → the
 *    `ignore` of `computeLessonLearnState`);
 *  - a `dictation` written by hand is typed instead (`typedInsteadOfHandwriting`).
 * The finished attempt carries a row per exercise left out (`skippedHandwritingRows`, `skipped:
 * 'handwriting'`, correct null) so the tutor's review says "skipped (handwriting off)".
 *
 * Pure; the Lab app's port (core/…/Handwriting.kt) is parity-tested against it.
 */
import type { CustomLessonSpec, LessonExercise } from './types';
import type { ExerciseAttempt } from './attempt';

/** An exercise the switch leaves out of a run. */
export function isHandwritingExercise(ex: Pick<LessonExercise, 'type'>): boolean {
  return ex.type === 'write_handwriting';
}

/** Whether the switch changes anything in this lesson (an exercise left out, or a dictation typed). */
export function lessonHasHandwriting(spec: Pick<CustomLessonSpec, 'sections'>): boolean {
  return spec.sections.some(s => s.exercises.some(ex =>
    isHandwritingExercise(ex) || (ex.type === 'dictation' && (ex as { input?: string }).input === 'handwrite')));
}

/** The keys (`s<section>e<index>`) of the exercises the switch leaves out. */
export function handwritingKeys(spec: Pick<CustomLessonSpec, 'sections'>): string[] {
  const out: string[] = [];
  spec.sections.forEach((s, si) => s.exercises.forEach((ex, i) => {
    if (isHandwritingExercise(ex)) out.push(`s${si}e${i}`);
  }));
  return out;
}

/** The exercise as the player shows it with the switch on: a handwritten dictation is typed. */
export function typedInsteadOfHandwriting<E extends LessonExercise>(ex: E): E {
  if (ex.type === 'dictation' && ex.input === 'handwrite') return { ...ex, input: 'type' };
  return ex;
}

/**
 * The attempt rows of the exercises a run left out (in lesson order): `only` = a revision's keys
 * (null = the whole lesson) — a handwriting exercise is "skipped" when the run would have asked it.
 */
export function skippedHandwritingRows(spec: Pick<CustomLessonSpec, 'sections'>, only?: readonly string[] | null): ExerciseAttempt[] {
  const wanted = only ? new Set(only) : null;
  const out: ExerciseAttempt[] = [];
  spec.sections.forEach((s, si) => s.exercises.forEach((ex, i) => {
    if (!isHandwritingExercise(ex)) return;
    if (wanted && !wanted.has(`s${si}e${i}`)) return;
    out.push({ section: si, index: i, type: ex.type, correct: null, points: 0, max_points: 0, duration_ms: 0, skipped: 'handwriting' });
  }));
  return out;
}

/** The tutor's attempt review line for a row left out. */
export const SKIPPED_HANDWRITING_LABEL = 'skipped (handwriting off)';
