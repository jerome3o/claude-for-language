/**
 * Updating students' copies when the tutor edits something she already sent
 * (docs/HOMEWORK.md §10). The MCP update tools (update_note, add_note,
 * batch_add_notes, update_library_lesson, update_reader) take
 * `update_student_copies` (default false — it SENDS to students) and, after their own edit succeeded,
 * call `POST /api/student-copies/update` once — a source with no copies comes
 * back `updated: 0` with no results, so no pre-check is needed.
 *
 * A failed copy update never fails the edit itself: it is reported in the
 * tool's reply ("Couldn't update Anna's copy: …").
 */
import { z } from 'zod';
import type { ApiClient } from '../api.js';

export type CopyKind = 'deck' | 'lesson' | 'reader' | 'link';

export const UPDATE_STUDENT_COPIES = z
  .boolean()
  .optional()
  .describe('SENDS to students: set true ONLY when the tutor explicitly asked, in this conversation, to update the copies already sent to her students too. Then a deck copy gets the new / edited words (progress kept), a lesson / reader copy is overwritten in place (history and schedule kept). Default false = only her own copy changes; say which students have a copy and ask.');

export interface CopyResult {
  relationship_id: string;
  student_name: string;
  ok: boolean;
  detail?: string | null;
  error?: string | null;
}

export interface CopiesOutcome {
  updated: number;
  results: CopyResult[];
  /** "Also updated Anna's copy." / "" when there were no copies. */
  message: string;
  /** Set when the update call itself failed (the edit still stands). */
  error?: string;
}

/** "Anna", "Anna and Ben", "Anna, Ben and Chen". Pure. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The sentence a tool reply carries about the students' copies. Pure — exported for tests. */
export function describeCopyResults(results: CopyResult[]): string {
  const ok = results.filter((r) => r.ok).map((r) => `${r.student_name || 'the student'}'s`);
  const failed = results.filter((r) => !r.ok);
  const parts: string[] = [];
  if (ok.length > 0) parts.push(`Also updated ${joinNames(ok)} ${ok.length === 1 ? 'copy' : 'copies'}.`);
  for (const f of failed) parts.push(`Couldn't update ${f.student_name || 'the student'}'s copy: ${f.error || f.detail || 'unknown error'}.`);
  return parts.join(' ');
}

/**
 * Bring the students' copies of one source up to date. Returns null when
 * `enabled` is false (nothing called). Never throws.
 */
export async function updateStudentCopies(api: ApiClient, kind: CopyKind, sourceId: string, enabled: boolean | undefined): Promise<CopiesOutcome | null> {
  if (enabled !== true) return null;
  try {
    const r = await api.post<{ updated?: number; results?: CopyResult[] }>('/api/student-copies/update', { kind, source_id: sourceId });
    const results = r.results ?? [];
    return { updated: r.updated ?? results.filter((x) => x.ok).length, results, message: describeCopyResults(results) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { updated: 0, results: [], message: `Your edit is saved, but the students' copies could not be updated (${error}).`, error };
  }
}

/** The compact form for a JSON reply (`student_copies`), or undefined when nothing was done. */
export function copiesForReply(o: CopiesOutcome | null) {
  if (!o || (o.results.length === 0 && !o.error)) return undefined;
  return {
    updated: o.updated,
    results: o.results.map((r) => ({ student_name: r.student_name, relationship_id: r.relationship_id, ok: r.ok, ...(r.detail ? { detail: r.detail } : {}), ...(r.error ? { error: r.error } : {}) })),
    ...(o.error ? { error: o.error } : {}),
  };
}
