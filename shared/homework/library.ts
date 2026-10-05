/**
 * The tutor's homework library (docs/HOMEWORK.md §9): ONE row per thing she
 * has sent a student — a deck copy, a lesson, a reader, a link — with when it
 * was sent, the due date, a progress % and a status (Completed / In progress /
 * Overdue / Not started). Built from what already exists: the share rows
 * (shared_decks / assigned custom_lessons / shared_readers) plus the
 * assignments pointing at the same copy. No second model.
 *
 * Progress uses the existing maths:
 *  - deck with a one-off pass (one_off / both): words got right in the pass / words in the pass
 *    (all its day-parts together); complete when every part is done.
 *  - deck in long-term review only (fsrs, or shared before assignments): status
 *    "In long-term review" whatever its progress — it is a deck in the queue, not homework
 *    with an end; `percent` / progress still say words met / words (minus left out).
 *  - lesson: completed at least once (or its assignment done) → 100 %.
 *  - reader: read at least once (or its assignment done) → 100 %.
 *  - link: the student marked it done → 100 %.
 *
 * Pure: the worker builds the rows (`buildHomeworkLibrary`), the web app and
 * the Lab app (core `HomeworkLibrary.kt`, parity-tested) filter, colour and
 * pick the most recent ones with the same functions.
 */

import { addDays, compareDue, daysBetween } from './due';
import { hasOneOff, type HomeworkAssignment, type HomeworkMode } from './types';

export type LibraryKind = 'deck' | 'lesson' | 'reader' | 'link';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['deck', 'lesson', 'reader', 'link'];

/**
 * `long_term`: a deck sent for long-term review only (fsrs, or shared before assignments). It is a
 * deck in the student's queue, not homework with an end — no %, no "In progress" (docs/HOMEWORK.md §11).
 */
export type LibraryStatus = 'completed' | 'in_progress' | 'overdue' | 'not_started' | 'long_term';
export const LIBRARY_STATUSES: readonly LibraryStatus[] = ['overdue', 'in_progress', 'not_started', 'completed', 'long_term'];

export const LIBRARY_STATUS_LABELS: Record<LibraryStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  overdue: 'Overdue',
  not_started: 'Not started',
  long_term: 'In long-term review',
};

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  deck: 'Words',
  lesson: 'Lesson',
  reader: 'Reader',
  link: 'Link',
};

export const LIBRARY_KIND_ICONS: Record<LibraryKind, string> = { deck: '📚', lesson: '🎓', reader: '📖', link: '🔗' };

/** The colour of a status: green done, red overdue, amber when due today / tomorrow and not done, else blue / grey. */
export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'grey';

/**
 * The status of one item. Completed wins; then a due date before today makes
 * it Overdue; then anything started is In progress.
 */
export function libraryStatus(input: { complete: boolean; started: boolean; due_date: string | null; today: string; long_term?: boolean }): LibraryStatus {
  if (input.long_term) return 'long_term';
  if (input.complete) return 'completed';
  if (input.due_date && daysBetween(input.today, input.due_date) < 0) return 'overdue';
  return input.started ? 'in_progress' : 'not_started';
}

/** Completed green · Overdue red · due today / tomorrow amber · In progress blue · Not started / long-term grey. */
export function statusTone(status: LibraryStatus, due_date: string | null, today: string): StatusTone {
  if (status === 'long_term') return 'grey';
  if (status === 'completed') return 'green';
  if (status === 'overdue') return 'red';
  if (due_date && daysBetween(today, due_date) <= 1) return 'amber';
  return status === 'in_progress' ? 'blue' : 'grey';
}

export interface LibraryItem {
  /** "<kind>:<target_id>" (a link: "link:<assignment id>"). */
  key: string;
  kind: LibraryKind;
  relationship_id: string;
  student_id: string;
  student_name: string;
  title: string;
  /** The tutor's master (deck / lesson_library item / reader / link); null when gone or unknown. */
  source_id: string | null;
  /** The student's copy (deck / custom_lessons / graded_readers id); a link: the link id. */
  target_id: string;
  /** shared_decks / shared_readers id (decks and readers). */
  share_id: string | null;
  /** ISO — when it was sent. */
  sent_at: string;
  /** The open due date (earliest unfinished one-off part), else the last part's; null = none. */
  due_date: string | null;
  /** How it was sent; null = shared before assignments existed (long-term review). */
  mode: HomeworkMode | null;
  /** 0..100 (a long_term deck: words met, shown as words, never as a %). */
  percent: number;
  /** "5 / 12 words", "8 / 20 words met", "done", "not started", "read", "not read yet". */
  progress: string;
  status: LibraryStatus;
  /** ISO, when it became complete (best known); null when not complete. */
  completed_at: string | null;
  /** The assignments behind this row (not cancelled). */
  assignment_ids: string[];
  /** The assignment "Change due date" moves (the first unfinished one-off part); null = none. */
  due_assignment_id: string | null;
  /** Deck: tutor words the student's copy does not have yet ("Update their copy"). */
  behind: number;
  /** Link homework: the link itself. */
  url: string | null;
  instructions: string | null;
  thumbnail_url: string | null;
  /** The student's note back when marking it done (newest), if any. */
  student_note: string | null;
}

// ---------- Inputs (what the worker reads) ----------

export interface LibraryDeckRow {
  share_id: string;
  source_id: string | null;
  target_id: string;
  title: string;
  shared_at: string;
  notes_total: number;
  notes_introduced: number;
  notes_left_out?: number;
  notes_missing: number;
  cards_started: number;
  /** The student deleted her copy. */
  target_deleted?: boolean;
}

export interface LibraryLessonRow {
  lesson_id: string;
  library_item_id: string | null;
  title: string;
  created_at: string;
  completions: number;
  last_completed_at: string | null;
}

export interface LibraryReaderRow {
  share_id: string;
  source_id: string | null;
  target_id: string;
  title: string;
  shared_at: string;
  read_count: number;
  last_read_at: string | null;
  target_deleted?: boolean;
}

export interface LibraryInput {
  relationship_id: string;
  student_id: string;
  student_name: string;
  assignments: HomeworkAssignment[];
  decks: LibraryDeckRow[];
  lessons: LibraryLessonRow[];
  readers: LibraryReaderRow[];
  /** Newest note per assignment id (from `done` events). */
  notes?: Record<string, string>;
  today: string;
}

function modeOf(list: HomeworkAssignment[]): HomeworkMode | null {
  if (list.length === 0) return null;
  if (list.some((a) => a.mode === 'both')) return 'both';
  if (list.some((a) => a.mode === 'one_off')) return list.some((a) => a.mode === 'fsrs') ? 'both' : 'one_off';
  return 'fsrs';
}

/** The due date shown: the earliest unfinished one-off part, else the last part's due date. */
function dueOf(oneOff: HomeworkAssignment[]): { due: string | null; dueId: string | null } {
  const dated = oneOff.filter((a) => a.due_date);
  const open = dated.filter((a) => a.status !== 'done').sort((a, b) => compareDue(a.due_date, b.due_date) || a.part_index - b.part_index);
  if (open.length > 0) return { due: open[0].due_date, dueId: open[0].id };
  const last = [...dated].sort((a, b) => compareDue(b.due_date, a.due_date))[0];
  const undated = oneOff.find((a) => a.status !== 'done');
  return { due: last?.due_date ?? null, dueId: last ? null : undated?.id ?? null };
}

function latest(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

/**
 * SQLite's datetime('now') ("2026-10-03 14:12:00", UTC) and ISO strings mixed
 * in one list sort wrongly as text (' ' < 'T'); every time on a row is ISO.
 */
export function isoTime(value: string): string;
export function isoTime(value: string | null): string | null;
export function isoTime(value: string | null): string | null {
  if (!value) return value;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}${/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? '' : 'Z'}` : value;
}

function pct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * done) / total)));
}

function noteOf(list: HomeworkAssignment[], notes: Record<string, string> | undefined): string | null {
  if (!notes) return null;
  for (const a of [...list].sort((x, y) => (y.completed_at ?? y.updated_at).localeCompare(x.completed_at ?? x.updated_at))) {
    if (notes[a.id]) return notes[a.id];
  }
  return null;
}

interface RowCore {
  key: string;
  kind: LibraryKind;
  title: string;
  source_id: string | null;
  target_id: string;
  share_id: string | null;
  sent_at: string;
  percent: number;
  progress: string;
  behind: number;
  complete: boolean;
  started: boolean;
  completed_at: string | null;
  /** A deck in long-term review only: status `long_term`. */
  long_term?: boolean;
}

/** Every item sent in one relationship, newest first. */
export function buildHomeworkLibrary(input: LibraryInput): LibraryItem[] {
  const { today } = input;
  const live = input.assignments.filter((a) => a.status !== 'cancelled');
  const byTarget = new Map<string, HomeworkAssignment[]>();
  for (const a of live) {
    const key = `${a.kind}:${a.target_id}`;
    const list = byTarget.get(key) ?? [];
    list.push(a);
    byTarget.set(key, list);
  }
  const base = { relationship_id: input.relationship_id, student_id: input.student_id, student_name: input.student_name };
  const items: LibraryItem[] = [];
  const finish = (
    partial: RowCore,
    list: HomeworkAssignment[]
  ) => {
    const oneOff = list.filter((a) => hasOneOff(a.mode));
    const { due, dueId } = dueOf(oneOff);
    const { complete, started, completed_at, long_term, ...rest } = partial;
    rest.sent_at = isoTime(rest.sent_at);
    const details = list.find((a) => a.details)?.details ?? null;
    items.push({
      ...base,
      ...rest,
      due_date: due,
      due_assignment_id: complete ? null : dueId,
      mode: modeOf(list),
      assignment_ids: list.map((a) => a.id),
      status: libraryStatus({ complete, started, due_date: due, today, long_term }),
      completed_at: complete ? isoTime(completed_at ?? latest(list.map((a) => a.completed_at))) : null,
      url: details?.url ?? null,
      instructions: details?.instructions ?? null,
      thumbnail_url: details?.thumbnail_url ?? null,
      student_note: noteOf(list, input.notes),
    });
  };

  for (const d of input.decks) {
    if (d.target_deleted) continue;
    const list = byTarget.get(`deck:${d.target_id}`) ?? [];
    const oneOff = list.filter((a) => hasOneOff(a.mode));
    let percent: number;
    let progress: string;
    let complete: boolean;
    let started: boolean;
    if (oneOff.length > 0) {
      const total = oneOff.reduce((s, a) => s + a.item_count, 0);
      const done = oneOff.reduce((s, a) => s + Math.min(a.done_count, a.item_count), 0);
      complete = oneOff.every((a) => a.status === 'done');
      percent = complete ? 100 : pct(done, total);
      progress = `${complete ? total : done} / ${total} words`;
      started = done > 0 || d.cards_started > 0;
    } else {
      const total = Math.max(0, d.notes_total - (d.notes_left_out ?? 0));
      const met = Math.min(total, d.notes_introduced);
      complete = total > 0 && met >= total;
      percent = pct(met, total);
      progress = `${met} / ${total} words met`;
      started = met > 0 || d.cards_started > 0;
    }
    finish(
      {
        key: `deck:${d.target_id}`,
        kind: 'deck',
        title: d.title,
        source_id: d.source_id,
        target_id: d.target_id,
        share_id: d.share_id,
        sent_at: d.shared_at,
        percent,
        progress,
        behind: d.notes_missing,
        complete,
        started,
        completed_at: null,
        long_term: oneOff.length === 0,
      },
      list
    );
  }

  for (const l of input.lessons) {
    const list = byTarget.get(`lesson:${l.lesson_id}`) ?? [];
    const complete = l.completions > 0 || (list.length > 0 && list.some((a) => a.status === 'done'));
    finish(
      {
        key: `lesson:${l.lesson_id}`,
        kind: 'lesson',
        title: l.title,
        source_id: l.library_item_id,
        target_id: l.lesson_id,
        share_id: null,
        sent_at: l.created_at,
        percent: complete ? 100 : 0,
        progress: complete ? (l.completions > 1 ? `done ${l.completions}×` : 'done') : 'not started',
        behind: 0,
        complete,
        started: complete,
        completed_at: l.last_completed_at,
      },
      list
    );
  }

  for (const r of input.readers) {
    if (r.target_deleted) continue;
    const list = byTarget.get(`reader:${r.target_id}`) ?? [];
    const complete = r.read_count > 0 || list.some((a) => a.status === 'done');
    finish(
      {
        key: `reader:${r.target_id}`,
        kind: 'reader',
        title: r.title,
        source_id: r.source_id,
        target_id: r.target_id,
        share_id: r.share_id,
        sent_at: r.shared_at,
        percent: complete ? 100 : 0,
        progress: complete ? 'read' : 'not read yet',
        behind: 0,
        complete,
        started: complete,
        completed_at: r.last_read_at,
      },
      list
    );
  }

  // Links have no copy: one row per assignment.
  for (const a of live.filter((x) => x.kind === 'link')) {
    const complete = a.status === 'done';
    finish(
      {
        key: `link:${a.id}`,
        kind: 'link',
        title: a.title,
        source_id: a.source_id,
        target_id: a.target_id,
        share_id: null,
        sent_at: a.created_at,
        percent: complete ? 100 : 0,
        progress: complete ? 'done' : 'not done yet',
        behind: 0,
        complete,
        started: complete,
        completed_at: a.completed_at,
      },
      [a]
    );
  }

  return sortLibrary(items);
}

/** Newest sent first (ties: title). */
export function sortLibrary<T extends Pick<LibraryItem, 'sent_at' | 'title'>>(items: T[]): T[] {
  const t = (x: string) => {
    const ms = Date.parse(isoTime(x));
    return isNaN(ms) ? 0 : ms;
  };
  return [...items].sort((a, b) => t(b.sent_at) - t(a.sent_at) || a.title.localeCompare(b.title));
}

export interface LibraryFilter {
  status?: LibraryStatus | null;
  kind?: LibraryKind | null;
  /** Free text over title and student name. */
  query?: string | null;
}

export function filterLibrary<T extends Pick<LibraryItem, 'status' | 'kind' | 'title' | 'student_name'>>(items: T[], filter: LibraryFilter): T[] {
  const q = (filter.query ?? '').trim().toLowerCase();
  return items.filter(
    (i) =>
      (!filter.status || i.status === filter.status) &&
      (!filter.kind || i.kind === filter.kind) &&
      (!q || i.title.toLowerCase().includes(q) || i.student_name.toLowerCase().includes(q))
  );
}

/** How many items per status (the filter chips' counts). */
export function libraryCounts(items: Pick<LibraryItem, 'status'>[]): Record<LibraryStatus, number> {
  const counts: Record<LibraryStatus, number> = { completed: 0, in_progress: 0, overdue: 0, not_started: 0, long_term: 0 };
  for (const i of items) counts[i.status]++;
  return counts;
}

/** Items sent within this long of the newest belong to the same "most recent homework". */
export const RECENT_BATCH_MS = 30 * 60 * 1000;
export const RECENT_LIMIT = 3;

/**
 * The most recent homework: the newest item plus anything sent with it (within
 * 30 minutes), at most 3 — the card at the top of the student's page.
 */
export function mostRecentHomework<T extends Pick<LibraryItem, 'sent_at' | 'title'>>(items: T[], limit = RECENT_LIMIT): T[] {
  const sorted = sortLibrary(items);
  if (sorted.length === 0) return [];
  const newest = Date.parse(sorted[0].sent_at);
  return sorted.filter((i) => !(newest - Date.parse(i.sent_at) > RECENT_BATCH_MS)).slice(0, limit);
}

/** "Due Thu 9 Oct" / "Due today" / "Due tomorrow" / "No due date" for a library row. */
export function libraryDueText(due_date: string | null, today: string): string {
  if (!due_date) return 'No due date';
  const days = daysBetween(today, due_date);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return 'Was due yesterday';
  if (days < 0) return `Was due ${-days} days ago`;
  return `Due in ${days} days`;
}

/** The dates offered by "Change due date": today, tomorrow, +3, +7. */
export function dueDateChoices(today: string): string[] {
  return [0, 1, 3, 7].map((n) => addDays(today, n));
}
