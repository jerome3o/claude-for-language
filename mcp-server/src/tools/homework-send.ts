/**
 * CREATE, THEN SEND (Oct 2026): every create tool makes content in the TUTOR's own
 * account and sends nothing; sending is a separate tool call that names the
 * student (`relationship_id`, optionally `student_name`, checked) and carries
 * `confirm: true`, which the model may only set after the tutor explicitly asked
 * to send that item to that student. `CONFIRM_SEND`, `resolveStudent`,
 * `NOT_SENT` and `sentTo` below are the one definition every tool uses.
 *
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

// ============ Create, then send ============

/**
 * The rule every tutor-facing tool follows (Minghui, Oct 2026: an agent sent a
 * 319-word deck she never meant to send). Create tools only ever write to the
 * tutor's own account; send tools take `confirm: true`.
 */
export const CREATE_THEN_SEND = `# Create, then send
Create content in the tutor's own account. Never send anything to a student unless the tutor explicitly asks you to send that item to that named student in this conversation. When in doubt, create it and ask.
- "Make / create / draft / prepare a deck (lesson, reader, homework) for Jerome" means CREATE ONLY: create_homework_deck, create_library_lesson, create_reader / generate_reader, add_student_lesson_notes (a draft), submit_session_notes. These save in the tutor's account and send nothing; their replies say "Saved in your account (not sent)".
- Sending is a separate call that names the student and carries confirm: true: share_deck_with_student, update_student_deck_copy, assign_lesson_to_students, push_lesson_update, share_reader_with_student, assign_homework, assign_homework_draft, send_session_notes_items. Their replies start "SENT to <student>". Pass student_name too when the tutor named the student.
- After creating, tell the tutor what was made and ask whether (and to whom) to send it. Never send "to be helpful", never send to every student, never pick the student yourself.`;


/** The sentence every send tool's description starts from. */
export const SEND_RULE =
  'SENDS to a student — only call it when the tutor has explicitly asked, in this conversation, to send this item to this named student. If they only asked you to make / create / draft something, do NOT send: create it in their account and ask.';

/** Required on every send tool: the model's explicit acknowledgement. */
export const CONFIRM_SEND = z
  .literal(true)
  .describe('Required, must be true. Set it ONLY after the tutor explicitly asked, in this conversation, to send this item to this named student ("send it to Jerome"). Never set it on your own initiative — when in doubt, do not send: ask the tutor.');

/** Optional cross-check of who the tutor named. */
export const STUDENT_NAME = z
  .string()
  .optional()
  .describe('The student\'s name as the tutor said it ("Jerome"). Checked against the relationship: a mismatch stops the send, so pass it whenever the tutor named the student.');

/** The refusal when a send tool is called without `confirm: true`. */
export const NEEDS_CONFIRM =
  'Not sent. This tool sends to a student and needs confirm: true — set it only after the tutor explicitly asked, in this conversation, to send this item to this named student. If they only asked you to make it, it is already saved in their account: tell them and ask whether to send it.';

/** What every create tool's reply says. */
export const NOT_SENT = 'Saved in your account (not sent). Say "send it to <student>" to share.';

/** "SENT to Jerome: …" — the first words of every send tool's message. */
export function sentTo(studentName: string, rest: string): string {
  return `SENT to ${studentName}: ${rest}`;
}

interface RelationshipRow {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: 'tutor' | 'student';
  status: string;
  requester?: { name?: string | null; email?: string | null };
  recipient?: { name?: string | null; email?: string | null };
}

export interface ResolvedStudent {
  relationship_id: string;
  name: string;
}

/** Does what the tutor said ("jerome", "Jerome Swannack") name this student? Pure. */
export function nameMatches(expected: string, name: string, email: string | null | undefined): boolean {
  const hay = `${name} ${email ?? ''}`.toLowerCase();
  const tokens = expected.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1);
  return tokens.length > 0 && tokens.some((t) => hay.includes(t));
}

/**
 * The student of a relationship the caller TUTORS (active), by name — or a
 * readable Error. Uses GET /api/relationships, the same list list_students
 * shows. `expectedName` (what the tutor said) must match when given.
 */
export async function resolveStudent(api: ApiClient, userId: string, relationshipId: string, expectedName?: string | null): Promise<ResolvedStudent> {
  const rels = await api.get<{ tutors?: RelationshipRow[]; students?: RelationshipRow[]; pending_incoming?: RelationshipRow[]; pending_outgoing?: RelationshipRow[] }>('/api/relationships');
  const all = [...(rels.students ?? []), ...(rels.tutors ?? []), ...(rels.pending_incoming ?? []), ...(rels.pending_outgoing ?? [])];
  const r = all.find((x) => x.id === relationshipId);
  if (!r) throw new Error(`No relationship ${relationshipId} on this account — take relationship_id from list_students (the students list, not my_tutors). Nothing was sent.`);
  const tutorIsRequester = r.requester_role === 'tutor';
  const tutorId = tutorIsRequester ? r.requester_id : r.recipient_id;
  if (tutorId !== userId) {
    const tutor = tutorIsRequester ? r.requester : r.recipient;
    throw new Error(`In relationship ${relationshipId} you are the STUDENT (the tutor is ${tutor?.name || tutor?.email || 'someone else'}); only the tutor can send homework. Nothing was sent.`);
  }
  if (r.status !== 'active') throw new Error(`Relationship ${relationshipId} is ${r.status}, not active yet. Nothing was sent.`);
  const student = tutorIsRequester ? r.recipient : r.requester;
  const name = student?.name || student?.email?.split('@')[0] || 'the student';
  if (expectedName && expectedName.trim() && !nameMatches(expectedName, name, student?.email)) {
    throw new Error(`relationship_id ${relationshipId} is ${name}, not "${expectedName.trim()}". Nothing was sent — check list_students and ask the tutor which student they meant.`);
  }
  return { relationship_id: relationshipId, name };
}

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
