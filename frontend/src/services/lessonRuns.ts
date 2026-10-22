/**
 * Half-done mini lessons on this device (shared/study/lessonRun.ts has the rules): one saved run
 * per lesson in IndexedDB (`lessonRuns`, Dexie v34), written after every exercise — where the run
 * stands (main pass / retry round), the score so far, every answer made (the attempt rows, with
 * the answer checks) and the recordings already made (blobs). Opening the lesson again — from
 * Home, the homework pass, the Mini Lessons page — continues it: "Continue where you left off
 * (7 of 18)" with Start over. Across days, app restarts and offline; never bounded by date.
 * Cleared by finishing the run (its recordings move to the upload queue), Start over, or a
 * change in the lesson's shape (the exercise types in order).
 *
 * Local only: nothing reaches the server until the run is finished.
 */
import type { ExerciseAttempt } from '@shared/lesson';
import { canResumeRun, type SavedLessonRunCore } from '@shared/study/lessonRun';
import { db } from '../db/database';

export interface SavedLessonRun extends SavedLessonRunCore {
  attempts: ExerciseAttempt[];
  /** Recordings made in exercises already answered. */
  recordings: Array<{ media_key: string; blob: Blob }>;
}

/** The run to continue for this lesson, or null (start fresh). A run that can't continue any more is dropped. */
export async function loadLessonRun(lessonId: string, shape: string): Promise<SavedLessonRun | null> {
  try {
    const saved = (await db.lessonRuns.get(lessonId)) as SavedLessonRun | undefined;
    if (!saved) return null;
    if (canResumeRun(saved, lessonId, shape)) return saved;
    await db.lessonRuns.delete(lessonId);
  } catch (err) {
    console.warn('[lessonRuns] load failed:', err);
  }
  return null;
}

/** After every exercise. Never throws (a failed save only means the run isn't kept). */
export async function saveLessonRun(run: SavedLessonRun): Promise<void> {
  try {
    await db.lessonRuns.put(run);
  } catch (err) {
    console.warn('[lessonRuns] save failed:', err);
  }
}

/** Finished, or Start over. */
export async function clearLessonRun(lessonId: string): Promise<void> {
  try {
    await db.lessonRuns.delete(lessonId);
  } catch { /* nothing kept */ }
}

/** Lessons with a run in progress on this device (the Mini Lessons page / Home say "continue"). */
export async function lessonRunsInProgress(): Promise<Map<string, SavedLessonRunCore>> {
  try {
    const rows = await db.lessonRuns.toArray();
    return new Map(rows.map(r => [r.lesson_id, r]));
  } catch {
    return new Map();
  }
}
