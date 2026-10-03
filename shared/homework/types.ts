/**
 * Homework assignments — the shapes both the worker and the app use.
 * See docs/HOMEWORK.md for the model.
 */

/** What is assigned. Free text so a future kind needs no migration; these four exist today. */
export type HomeworkKind = 'deck' | 'lesson' | 'reader' | 'link' | (string & {});

/**
 * Extra fields an assignment carries (assignments.details, JSON). A link
 * assignment holds the link itself — a snapshot of the tutor's link, so the
 * student's homework keeps working if the tutor edits or deletes it.
 */
export interface HomeworkDetails {
  url?: string | null;
  instructions?: string | null;
  thumbnail_url?: string | null;
}

/**
 * How it is studied:
 * - one_off: a single pass by the due date, not spaced repetition
 * - fsrs: long-term review (the FSRS queue — what "send a deck" always did)
 * - both: a one-off pass by the due date AND long-term review
 */
export type HomeworkMode = 'one_off' | 'fsrs' | 'both';
export const HOMEWORK_MODES: readonly HomeworkMode[] = ['one_off', 'fsrs', 'both'];

export type HomeworkStatus = 'active' | 'done' | 'cancelled';

/** A pass event: a word marked right / wrong, or a lesson / reader completed. */
export type HomeworkResult = 'right' | 'wrong' | 'done';

export interface HomeworkAssignment {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  /** Items assigned together (a draft's job id, or one POST). */
  batch_id: string | null;
  kind: HomeworkKind;
  /** The STUDENT's copy: deck id / custom_lessons id / graded_readers id. */
  target_id: string;
  /** The tutor's master: deck / lesson_library item / reader. */
  source_id: string | null;
  title: string;
  mode: HomeworkMode;
  /** Calendar day in the student's time zone ('YYYY-MM-DD'); null for fsrs-only. */
  due_date: string | null;
  /** Deck: the note ids (student's copy) this part covers. Lesson / reader: null (the target itself). */
  item_ids: string[] | null;
  item_count: number;
  /** Split plan: part `part_index + 1` of `part_count`. */
  part_index: number;
  part_count: number;
  status: HomeworkStatus;
  done_count: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for display. */
  tutor_name?: string | null;
  /** Link homework: the link, instructions and thumbnail (null for other kinds). */
  details?: HomeworkDetails | null;
}

export interface HomeworkEvent {
  /** Client-generated; uploads are idempotent by id. */
  id: string;
  assignment_id: string;
  /** Deck: a note id. Lesson / reader: the target id. */
  item_id: string;
  result: HomeworkResult;
  created_at: string;
  /** Optional note back to the tutor (a `done` event, e.g. on link homework). */
  note?: string | null;
}

export function isHomeworkMode(value: unknown): value is HomeworkMode {
  return value === 'one_off' || value === 'fsrs' || value === 'both';
}

/** Does this mode include a one-off pass (and so a due date)? */
export function hasOneOff(mode: HomeworkMode): boolean {
  return mode === 'one_off' || mode === 'both';
}

/** Does this mode put the item in long-term (FSRS) review? */
export function hasFsrs(mode: HomeworkMode): boolean {
  return mode === 'fsrs' || mode === 'both';
}

export const MODE_LABELS: Record<HomeworkMode, string> = {
  one_off: 'One-off',
  fsrs: 'Long-term review',
  both: 'One-off + long-term',
};

/** The item ids a pass walks: the deck part's notes, or the lesson / reader itself. */
export function passItemIds(a: Pick<HomeworkAssignment, 'kind' | 'item_ids' | 'target_id'>): string[] {
  if (a.kind === 'deck') return a.item_ids ?? [];
  return [a.target_id];
}
