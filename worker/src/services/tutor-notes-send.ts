/**
 * Sending what a session-notes job made — the explicit second step.
 *
 * A job creates its deck / mini lessons / reader in the TUTOR's account and,
 * unless the tutor asked for `auto_share` (off by default since Oct 2026), sends
 * nothing. The job card then offers "Send to <student>" per item and "Send all";
 * both land here and go through `assignHomework` — the same path as the Send
 * homework sheet — so the student gets a real assignment.
 *
 * Item keys follow the draft plan's: "deck", "lesson:<library_item_id>", "reader".
 */

import { DEFAULT_SEND_MODE, isDateString, isHomeworkMode, localDate, unsentJobItems as unsentFromShared, type HomeworkMode, type UnsentItem } from '@shared/homework';
import type { Env } from '../types';
import * as jobs from '../db/tutor-notes-queries';
import { assignHomework, type AssignRequestItem, type AssignResult } from './homework';

export type JobItem = UnsentItem;

/** The items of a job result that are still only in the tutor's account (shared/homework/send.ts). */
export function unsentJobItems(result: jobs.TutorNotesResult): JobItem[] {
  return unsentFromShared(result);
}

/** Write the student's copies back onto the result so the card shows "sent". Pure: returns a new result. */
export function markSent(result: jobs.TutorNotesResult, copies: AssignResult['copies'], at: string): jobs.TutorNotesResult {
  const next: jobs.TutorNotesResult = JSON.parse(JSON.stringify(result));
  for (const c of copies) {
    if (c.kind === 'deck' && next.deck?.id === c.source_id) {
      next.deck.target_deck_id = c.target_id;
      next.deck.shared_at = at;
    } else if (c.kind === 'lesson') {
      const l = next.lessons?.find((x) => x.library_item_id === c.source_id);
      if (l) l.lesson_id = c.target_id;
    } else if (c.kind === 'reader' && next.reader?.id === c.source_id) {
      next.reader.target_reader_id = c.target_id;
    }
  }
  return next;
}

export class SendJobError extends Error {
  constructor(public status: 400 | 409, message: string) {
    super(message);
  }
}

export interface SendJobOptions {
  /** Which items; omitted / empty = every unsent item ("Send all"). */
  keys?: string[] | null;
  mode?: unknown;
  due_date?: unknown;
  today?: unknown;
}

/** Send the chosen (or all unsent) items of a finished job to its student. */
export async function sendJobItems(env: Env, job: jobs.TutorNotesJob, o: SendJobOptions = {}): Promise<{ job: jobs.TutorNotesJob; sent: JobItem[]; result: AssignResult }> {
  if (job.status !== 'done') throw new SendJobError(409, 'The assistant is not finished with these notes yet');
  if (job.review) throw new SendJobError(409, 'This is a homework draft — review it and use Assign');
  const unsent = unsentJobItems(job.result);
  const wanted = o.keys && o.keys.length > 0 ? unsent.filter((i) => o.keys!.includes(i.key)) : unsent;
  if (wanted.length === 0) throw new SendJobError(400, unsent.length === 0 ? 'Everything from these notes has already been sent' : 'None of those items can be sent');

  const mode: HomeworkMode = isHomeworkMode(o.mode) ? o.mode : DEFAULT_SEND_MODE;
  if (o.due_date != null && !isDateString(o.due_date)) throw new SendJobError(400, 'due_date must be YYYY-MM-DD');
  const today = isDateString(o.today) ? o.today : localDate(new Date());
  const items: AssignRequestItem[] = wanted.map((i) => ({
    kind: i.kind,
    source_id: i.source_id,
    mode,
    due_date: (o.due_date as string | null | undefined) ?? null,
    split_days: 1,
    ...(i.kind === 'deck' ? { priority: job.priority, skip_known: true } : {}),
  }));
  const result = await assignHomework(env, {
    relationshipId: job.relationship_id,
    tutorId: job.tutor_id,
    studentId: job.student_id,
    items,
    batchId: job.id,
    today,
  });
  const at = new Date().toISOString();
  const nextResult = markSent(job.result, result.copies, at);
  const sent = wanted.filter((i) => result.copies.some((c) => c.kind === i.kind && c.source_id === i.source_id));
  const steps = [
    ...job.steps,
    ...sent.map((i) => ({ at, kind: 'done' as const, text: `Sent "${i.title}" to the student` })),
    ...result.errors.map((e) => ({ at, kind: 'warn' as const, text: `Could not send ${wanted.find((i) => i.source_id === e.source_id)?.title ?? 'an item'}: ${e.error}` })),
  ];
  await jobs.patchJob(env.DB, job.id, { result: nextResult, steps });
  return { job: { ...job, result: nextResult, steps }, sent, result };
}
