/**
 * Push a library lesson to the students who have a copy (docs/HOMEWORK.md §10):
 * overwrite each copy's spec in place — same lesson ids, so the students'
 * completion history and FSRS schedule survive. Kept illustrations carry over;
 * new image prompts are queued. Used by `POST /api/lesson-library/:id/push-update`
 * and `POST /api/student-copies/update`.
 */

import type { Env } from '../types';
import { canonicalJson, lessonToExportSpec, type CustomLessonSpec } from '@shared/lesson';
import * as lib from '../db/lesson-library-queries';
import { mergeKeptImages, queueLessonImages } from './custom-lesson';

/** Two specs are "the same lesson content" ignoring server-filled fields. */
export function sameLessonContent(a: CustomLessonSpec, b: CustomLessonSpec): boolean {
  return canonicalJson(lessonToExportSpec(a)) === canonicalJson(lessonToExportSpec(b));
}

export interface LessonPushResult {
  updated: number;
  skipped: number;
  image_jobs: number;
  /** Per copy: the relationship it was assigned in and whether it changed. */
  copies: Array<{ lesson_id: string; relationship_id: string | null; student_name: string | null; updated: boolean }>;
}

/** null when the item is not the caller's. `only` limits it to some relationships. */
export async function pushLibraryLessonUpdate(env: Env, userId: string, itemId: string, only: Set<string> | null): Promise<LessonPushResult | null> {
  const item = await lib.getLibraryItem(env.DB, itemId, userId);
  if (!item) return null;
  const itemSpec = JSON.parse(item.spec) as CustomLessonSpec;
  const rows = await lib.listAssignmentsForItem(env.DB, item.id);
  const out: LessonPushResult = { updated: 0, skipped: 0, image_jobs: 0, copies: [] };
  for (const row of rows) {
    if (only && (!row.assigned_relationship_id || !only.has(row.assigned_relationship_id))) continue;
    const copySpec = JSON.parse(row.spec) as CustomLessonSpec;
    const student = (row as { student_name?: string | null }).student_name ?? null;
    if (sameLessonContent(copySpec, itemSpec)) {
      out.skipped++;
      out.copies.push({ lesson_id: row.id, relationship_id: row.assigned_relationship_id ?? null, student_name: student, updated: false });
      continue;
    }
    const next = mergeKeptImages(copySpec, JSON.parse(JSON.stringify(itemSpec)) as CustomLessonSpec);
    await lib.updateLessonSpecById(env.DB, row.id, {
      title: next.title,
      description: next.description ?? null,
      icon: next.icon ?? null,
      spec: JSON.stringify(next),
    });
    out.image_jobs += await queueLessonImages(env, row.id, next);
    out.updated++;
    out.copies.push({ lesson_id: row.id, relationship_id: row.assigned_relationship_id ?? null, student_name: student, updated: true });
  }
  return out;
}
