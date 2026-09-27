/**
 * Lesson notes → homework DRAFT → review → assign (docs/HOMEWORK.md §4).
 *
 * A draft is a session-notes job with `review = 1`: the agent builds the deck
 * (+ lesson / reader) in the tutor's account and a plan, nothing is sent. The
 * review page reads `buildDraftView` (words with the ones the student already
 * has skipped, the plan, the chat, the load now and after); the tutor's chat
 * messages continue the same job (`appendTutorRequest`); `assignDraft` turns
 * the plan into assignments through the usual `assignHomework`.
 */

import type { Env } from '../types';
import {
  computeHomeworkLoad,
  dedupeWords,
  normalizeDraftPlan,
  plannedLoad,
  type DraftPlan,
  type HomeworkLoad,
} from '@shared/homework';
import * as jobs from '../db/tutor-notes-queries';
import * as hw from '../db/homework-queries';
import { assignHomework, studentLoadInputs, HomeworkError, type AssignRequestItem, type AssignResult } from './homework';
import { draftContents } from './tutor-notes-agent';

export interface DraftWord {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  /** Set when the student already has it: where, and in what state. */
  known: { deck_name: string; state: string } | null;
  /** Skipped from the assignment (known and not included anyway, or a repeat). */
  skipped: boolean;
}

export interface DraftView {
  student_name: string;
  job: Omit<jobs.TutorNotesJob, 'transcript'>;
  plan: DraftPlan;
  words: DraftWord[];
  kept_count: number;
  skipped_count: number;
  load: HomeworkLoad;
  load_after: HomeworkLoad;
  assignments: Awaited<ReturnType<typeof hw.listBatchAssignments>>;
}

export async function buildDraftView(env: Env, job: jobs.TutorNotesJob, today: string): Promise<DraftView> {
  const contents = draftContents(job.result);
  const plan = normalizeDraftPlan(job.plan, contents, today);
  // Once assigned, the student's copy of the words must not count as "already has".
  const copies = job.result.deck?.target_deck_id ? [job.result.deck.target_deck_id] : [];
  const [notes, studentHanzi, loadInputs, assignments, student] = await Promise.all([
    contents.deck ? hw.listDeckNotes(env.DB, contents.deck.id) : Promise.resolve([]),
    hw.listStudentHanzi(env.DB, job.student_id, copies),
    studentLoadInputs(env.DB, job.student_id),
    hw.listBatchAssignments(env.DB, job.id),
    jobs.getUserBrief(env.DB, job.student_id).catch(() => null),
  ]);
  const { keep, skipped } = dedupeWords(notes, studentHanzi, plan.include_known);
  const skippedIds = new Set(skipped.map((s) => s.word.id));
  const knownMatches = skipped.length || plan.include_known.length ? await jobs.findStudentWords(env.DB, job.student_id, notes.map((n) => n.hanzi)) : new Map();
  const words: DraftWord[] = notes.map((n) => {
    const m = knownMatches.get(n.hanzi.trim())?.[0];
    return { id: n.id, hanzi: n.hanzi, pinyin: n.pinyin, english: n.english, known: m ? { deck_name: m.deck_name, state: m.state } : null, skipped: skippedIds.has(n.id) };
  });
  const load = computeHomeworkLoad({ assignments: loadInputs.active, today, fsrsWordsToGo: loadInputs.fsrsWordsToGo, newPerDay: loadInputs.newPerDay });
  const planned = job.assigned_at ? { assignments: [], fsrsWords: 0 } : plannedLoad(plan, keep.length, today);
  const load_after = computeHomeworkLoad({
    assignments: [...loadInputs.active, ...planned.assignments],
    today,
    fsrsWordsToGo: loadInputs.fsrsWordsToGo + planned.fsrsWords,
    newPerDay: loadInputs.newPerDay,
  });
  const { transcript: _t, ...rest } = job;
  return { student_name: student?.name ?? 'the student', job: rest, plan, words, kept_count: keep.length, skipped_count: skipped.length, load, load_after, assignments };
}

/** The assignable items of a plan. Pure. */
export function planToItems(plan: DraftPlan): AssignRequestItem[] {
  return plan.items
    .filter((i) => i.include)
    .map((i) => ({
      kind: i.kind,
      source_id: i.source_id,
      mode: i.mode,
      due_date: i.due_date,
      title: i.kind === 'deck' ? i.title : undefined,
      ...(i.kind === 'deck' ? { split_days: plan.split_days, priority: plan.priority, skip_known: true, include_known: plan.include_known } : {}),
    }));
}

/** Turn the draft's plan into assignments. Once only. */
export async function assignDraft(env: Env, job: jobs.TutorNotesJob, today: string): Promise<AssignResult> {
  if (job.status !== 'done') throw new HomeworkError(409, 'The draft is not ready yet');
  if (job.assigned_at) throw new HomeworkError(409, 'This draft was already assigned');
  const plan = normalizeDraftPlan(job.plan, draftContents(job.result), today);
  const items = planToItems(plan);
  if (items.length === 0) throw new HomeworkError(400, 'Nothing is included in the plan');
  const result = await assignHomework(env, { relationshipId: job.relationship_id, tutorId: job.tutor_id, studentId: job.student_id, items, batchId: job.id, today });
  if (result.assignments.length === 0) throw new HomeworkError(400, result.errors[0]?.error ?? 'Nothing could be assigned');
  const at = new Date().toISOString();
  const deckRow = result.assignments.find((a) => a.kind === 'deck');
  if (deckRow && job.result.deck) {
    job.result.deck.target_deck_id = deckRow.target_id;
    job.result.deck.shared_at = at;
  }
  for (const l of job.result.lessons ?? []) {
    const row = result.assignments.find((a) => a.kind === 'lesson' && a.source_id === l.library_item_id);
    if (row) l.lesson_id = row.target_id;
  }
  const readerRow = result.assignments.find((a) => a.kind === 'reader');
  if (readerRow && job.result.reader) job.result.reader.target_reader_id = readerRow.target_id;
  await jobs.patchJob(env.DB, job.id, {
    assigned_at: at,
    result: job.result,
    plan,
    steps: [...job.steps, { at, kind: 'done', text: `Assigned ${result.assignments.length} item${result.assignments.length === 1 ? '' : 's'} to the student` }],
  });
  return result;
}
