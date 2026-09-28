/**
 * Sending a deck / library lesson / reader to a student AS HOMEWORK (docs/HOMEWORK.md):
 * every MCP path that sends something (share_deck_with_student, create_deck_for_student,
 * assign_lesson_to_students, share_reader_with_student and the MCP Apps' send buttons)
 * goes through `POST /api/relationships/:relId/homework`, so it creates a real assignment
 * — by default `both` (a one-off pass by the due date, then long-term review), due at the
 * student's next logged lesson, else in two days — like the app's Send homework sheet.
 */
import { z } from 'zod';
import type { ApiClient } from '../api.js';
import {
  DEFAULT_SEND_MODE,
  defaultHomeworkDueDate,
  hasOneOff,
  isDateString,
  lessonDay,
  localDate,
  shortDay,
  type HomeworkAssignment,
  type HomeworkMode,
} from '../../../shared/homework';

export const SEND_MODE = z
  .enum(['one_off', 'fsrs', 'both'])
  .optional()
  .describe('How the student does it. "both" (default): a one-off pass by the due date (each word once, missed ones again until right; a lesson / reader once) AND long-term spaced review. "one_off": only the pass — never enters their daily review. "fsrs": only long-term review, no due date (the old "share").');

export const SEND_DUE_DATE = z
  .string()
  .optional()
  .describe('YYYY-MM-DD the one-off pass is due (the student\'s calendar day). Default: the student\'s next logged lesson (a lesson-log entry in the next 14 days), else in two days. Ignored for mode "fsrs".');

export const SEND_TODAY = z.string().optional().describe('The tutor\'s today as YYYY-MM-DD (for the default due date). Default: today in UTC.');

export interface SendOptions {
  mode?: HomeworkMode;
  due_date?: string;
  today?: string;
  /** Deck only. */
  priority?: 'core' | 'non_urgent';
  /** Deck only (default true on the API). */
  skip_known?: boolean;
}

export interface HomeworkCopy {
  kind: string;
  source_id: string;
  target_id: string;
  target_name: string;
  share_id: string | null;
}

export interface SendResult {
  assignments: HomeworkAssignment[];
  skipped: Array<{ source_id: string; hanzi: string[] }>;
  errors: Array<{ source_id: string; error: string }>;
  copies?: HomeworkCopy[];
}

export interface Sent {
  mode: HomeworkMode;
  due_date: string | null;
  result: SendResult;
  copy: HomeworkCopy | null;
}

const rel = (id: string) => `/api/relationships/${encodeURIComponent(id)}`;

/** The due date a send defaults to: the student's next logged lesson, else in two days. Never throws. */
export async function defaultDueFor(api: ApiClient, relationshipId: string, today: string): Promise<string> {
  try {
    const log = await api.get<{ entries?: Array<{ lesson_at: string }> }>(`${rel(relationshipId)}/lesson-log`);
    return defaultHomeworkDueDate(today, (log.entries ?? []).map((e) => lessonDay(e.lesson_at)));
  } catch {
    return defaultHomeworkDueDate(today);
  }
}

/**
 * Send one item as homework. Throws (ApiError) when the API refuses it; a
 * per-item error without any assignment is thrown as an Error too.
 */
export async function sendAsHomework(api: ApiClient, relationshipId: string, kind: 'deck' | 'lesson' | 'reader', sourceId: string, o: SendOptions = {}): Promise<Sent> {
  const today = o.today && isDateString(o.today) ? o.today : localDate(new Date());
  const mode = o.mode ?? DEFAULT_SEND_MODE;
  if (o.due_date !== undefined && !isDateString(o.due_date)) throw new Error(`due_date must be YYYY-MM-DD (got "${o.due_date}")`);
  const due = hasOneOff(mode) ? o.due_date ?? (await defaultDueFor(api, relationshipId, today)) : null;
  const item: Record<string, unknown> = { kind, source_id: sourceId, mode, due_date: due };
  if (kind === 'deck') {
    item.priority = o.priority ?? 'core';
    if (o.skip_known !== undefined) item.skip_known = o.skip_known;
  }
  const result = await api.post<SendResult>(`${rel(relationshipId)}/homework`, { items: [item], today });
  if (result.assignments.length === 0) throw new Error(result.errors[0]?.error ?? 'Nothing could be assigned');
  const copy = result.copies?.find((c) => c.source_id === sourceId) ?? null;
  return { mode, due_date: due, result, copy };
}

/** "as homework due Wed 30 Sep, then in long-term review" — for tool messages. */
export function describeSend(mode: HomeworkMode, due: string | null): string {
  if (!hasOneOff(mode) || !due) return 'into their long-term review';
  return `as one-off homework due ${shortDay(due)}${mode === 'both' ? ', then in long-term review' : ''}`;
}

/** The ids a chat needs from the created rows. */
export function assignmentSummary(rows: HomeworkAssignment[]) {
  return rows.map((a) => ({ id: a.id, title: a.title, mode: a.mode, due_date: a.due_date, item_count: a.item_count }));
}

export interface LessonSendOutcome {
  assigned: Array<{ relationship_id: string; lesson_id: string; student_id: string; assignment_ids: string[]; due_date: string | null }>;
  already_had: Array<{ relationship_id: string; lesson_id: string; student_id: string }>;
  errors: Array<{ relationship_id: string; error: string }>;
  mode: HomeworkMode;
}

/**
 * A library lesson as homework for several students. A student who already has a
 * copy is left alone (reported under already_had — assign_homework makes a new
 * assignment on it); everyone else gets their copy + assignment. Per-student
 * failures are collected, not thrown.
 */
export async function assignLessonAsHomework(
  api: ApiClient,
  libraryId: string,
  relationshipIds: string[],
  o: Omit<SendOptions, 'priority' | 'skip_known'> = {},
): Promise<LessonSendOutcome> {
  const mode = o.mode ?? DEFAULT_SEND_MODE;
  const existing = await api
    .get<{ assignments?: Array<{ relationship_id?: string | null; lesson_id: string; student?: { id: string } }> }>(`/api/lesson-library/${encodeURIComponent(libraryId)}/assignments`)
    .then((r) => r.assignments ?? [])
    .catch(() => []);
  const out: LessonSendOutcome = { assigned: [], already_had: [], errors: [], mode };
  for (const relId of relationshipIds) {
    const had = existing.find((a) => a.relationship_id === relId);
    if (had) {
      out.already_had.push({ relationship_id: relId, lesson_id: had.lesson_id, student_id: had.student?.id ?? '' });
      continue;
    }
    try {
      const sent = await sendAsHomework(api, relId, 'lesson', libraryId, { ...o, mode });
      const rows = sent.result.assignments;
      out.assigned.push({
        relationship_id: relId,
        lesson_id: sent.copy?.target_id ?? rows[0].target_id,
        student_id: rows[0].student_id,
        assignment_ids: rows.map((a) => a.id),
        due_date: sent.due_date,
      });
    } catch (err) {
      out.errors.push({ relationship_id: relId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
