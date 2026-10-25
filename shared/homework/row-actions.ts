/**
 * The long-press / ⋯ menu on a homework or mini lesson row (Home's card, /homework, Mini Lessons'
 * To do; docs/HOMEWORK.md §3d, docs/STUDY_SESSION.md "Row menu").
 *
 * Jerome (Oct 2026): "can you make it so that I can like long click on any revision or homework and
 * then opt to remove it or ignore it? … it's teaching me how to write characters, and I don't
 * actually want to write characters … so I can learn off some of the lessons or just delete them."
 *
 *  - a revision, or a lesson of his own: **Stop revising — done for good** (a `revisit_events`
 *    retire — the lesson is done forever, shared/study/lessonRevision.ts; Undo = a restore) and
 *    **Delete lesson** (confirmed; DELETE /api/custom-lessons/:id);
 *  - homework from the tutor: **Skip this homework** — a `skip` pass event on the assignment
 *    (shared/homework/pass.ts `liveSkip`): out of his To do, "Skipped by <student>" on her views;
 *    confirmed (the confirm says she will see it), Undo; her item is never deleted;
 *  - any lesson with handwriting while the setting is off: **Skip handwriting exercises** — turns on
 *    the account's switch (shared/lesson/handwriting.ts).
 *
 * Pure; the Lab app's port (core/…/HomeworkRowActions.kt) is parity-tested against it.
 */

export type HomeworkRowAction = 'done_for_good' | 'delete_lesson' | 'skip_homework' | 'skip_handwriting';

/**
 * What the row is: `assignment` = the tutor's one-off homework (any kind); `tutor_lesson` = a new
 * lesson the tutor sent for long-term review; `revision` = a mini lesson revision; `lesson` = any
 * other lesson (his own, agent-made, a podcast companion).
 */
export type HomeworkRowKind = 'assignment' | 'tutor_lesson' | 'revision' | 'lesson';

export interface HomeworkRowActionInput {
  kind: HomeworkRowKind;
  /** The assignment behind the row, when there is one. */
  assignment_id: string | null;
  /** The mini lesson the row plays, when it is one. */
  lesson_id: string | null;
  /** The lesson has a handwriting exercise / a handwritten dictation (`lessonHasHandwriting`). */
  has_handwriting: boolean;
  /** "Skip handwriting exercises" is already on. */
  skip_handwriting: boolean;
}

/** The menu's actions, in order. Empty = no menu. */
export function homeworkRowActions(input: HomeworkRowActionInput): HomeworkRowAction[] {
  const out: HomeworkRowAction[] = [];
  if (input.kind === 'assignment' || input.kind === 'tutor_lesson') {
    if (input.assignment_id) out.push('skip_homework');
    else if (input.kind === 'tutor_lesson' && input.lesson_id) out.push('done_for_good', 'delete_lesson');
  } else if (input.lesson_id) {
    out.push('done_for_good', 'delete_lesson');
  }
  if (input.lesson_id && input.has_handwriting && !input.skip_handwriting) out.push('skip_handwriting');
  return out;
}

/** The row kind of a Home / homework card row (shared/homework/home.ts) by its key and kind. */
export function homeRowKind(row: { key: string; kind: string }): HomeworkRowKind {
  if (row.key.startsWith('revision:')) return 'revision';
  if (row.key.startsWith('lesson:')) return 'tutor_lesson';
  return 'assignment';
}

/** The menu item's words. */
export function homeworkRowActionLabel(action: HomeworkRowAction, kind: HomeworkRowKind): string {
  switch (action) {
    case 'done_for_good': return kind === 'revision' ? 'Stop revising — done for good' : 'Done for good — stop showing it';
    case 'delete_lesson': return 'Delete lesson';
    case 'skip_homework': return 'Skip this homework';
    case 'skip_handwriting': return 'Skip handwriting exercises';
  }
}

/** The menu item's icon. */
export function homeworkRowActionIcon(action: HomeworkRowAction): string {
  switch (action) {
    case 'done_for_good': return '✓';
    case 'delete_lesson': return '🗑';
    case 'skip_homework': return '⏭';
    case 'skip_handwriting': return '✍️';
  }
}

/** The confirm before it happens; null = no confirm (it can be undone straight away). */
export function homeworkRowActionConfirm(action: HomeworkRowAction, item: { title: string; tutor_name: string | null }): string | null {
  if (action === 'skip_homework') {
    return `Skip “${item.title}”? ${item.tutor_name || 'Your tutor'} will see it as skipped. You can undo this.`;
  }
  if (action === 'delete_lesson') {
    return `Delete “${item.title}”? This can't be undone.`;
  }
  return null;
}

/** The toast after it happened (with Undo, except a delete). */
export function homeworkRowActionToast(action: HomeworkRowAction, item: { tutor_name: string | null }): string {
  switch (action) {
    case 'done_for_good': return "Done for good — it won't come back";
    case 'delete_lesson': return 'Lesson deleted';
    case 'skip_homework': return `Skipped — ${item.tutor_name || 'your tutor'} will see it`;
    case 'skip_handwriting': return 'Handwriting exercises skipped from now on';
  }
}

/** Whether the toast offers Undo. */
export function homeworkRowActionUndoable(action: HomeworkRowAction): boolean {
  return action !== 'delete_lesson';
}
