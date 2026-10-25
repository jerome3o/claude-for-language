/**
 * What the student's homework screens show, computed from the mirrored
 * assignments and the pass events (docs/HOMEWORK.md §3). Pure — the web app's
 * services/homework.ts and the Lab app (android-lab core `HomeworkItems.kt`,
 * parity-tested) both use these rules.
 */

import { compareDue, dueLabel, type DueLabel } from './due';
import { libraryStatus, type LibraryStatus } from './library';
import { isSkipped, liveSkip, passProgress, passSummary, type PassProgress } from './pass';
import { passRetryBar, type RetryBar } from './retry-bar';
import { passItemIds, type HomeworkAssignment, type HomeworkEvent } from './types';

export interface HomeworkItemView<A extends HomeworkAssignment = HomeworkAssignment> {
  assignment: A;
  progress: PassProgress;
  due: DueLabel;
  /** Done on this device or on the server. */
  done: boolean;
  /** Skipped by the student ("Skip this homework", docs/HOMEWORK.md §3d) and not done. */
  skipped: boolean;
  /** When it was skipped (the live skip event, else the server's skipped_at); null when not skipped. */
  skipped_at: string | null;
  /** The pass's retry bar (blue answered · orange "Not yet" owed); `answered` 0 = not started. */
  bar: RetryBar;
}

/** What the screens need of an event (id + undoes: an undo takes an answer back, `livePassEvents`). */
type ItemEvent = Pick<HomeworkEvent, 'assignment_id' | 'item_id' | 'result' | 'created_at'> & Partial<Pick<HomeworkEvent, 'id' | 'undoes'>>;

/** One-off assignments (not fsrs-only, not cancelled) with their pass progress and due label. */
export function toHomeworkItems<A extends HomeworkAssignment>(
  assignments: A[],
  events: ItemEvent[],
  today: string
): HomeworkItemView<A>[] {
  const byAssignment = new Map<string, ItemEvent[]>();
  for (const e of events) {
    const list = byAssignment.get(e.assignment_id) ?? [];
    list.push(e);
    byAssignment.set(e.assignment_id, list);
  }
  return assignments
    .filter((a) => a.mode !== 'fsrs' && a.status !== 'cancelled')
    .map((a) => {
      const list = byAssignment.get(a.id) ?? [];
      const progress = passProgress(passItemIds(a), list);
      const done = a.status === 'done' || progress.complete;
      const skipped = !done && isSkipped(list, a.skipped_at);
      const skippedAt = skipped ? liveSkip(list)?.created_at ?? a.skipped_at ?? null : null;
      return { assignment: a, progress, due: dueLabel(a.due_date, today), done, skipped, skipped_at: skippedAt, bar: passRetryBar(passItemIds(a), list) };
    });
}

/** Code-unit order (the Kotlin port's String.compareTo). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * To do first: overdue, then by due date, then by part; done ones newest first; skipped ones (not
 * done) on their own, most recently skipped first — never in To do.
 */
export function sortHomeworkItems<A extends HomeworkAssignment>(items: HomeworkItemView<A>[]): { todo: HomeworkItemView<A>[]; done: HomeworkItemView<A>[]; skipped: HomeworkItemView<A>[] } {
  const todo = items
    .filter((i) => !i.done && !i.skipped)
    .sort((a, b) => compareDue(a.assignment.due_date, b.assignment.due_date) || a.assignment.part_index - b.assignment.part_index || a.assignment.created_at.localeCompare(b.assignment.created_at));
  const done = items
    .filter((i) => i.done)
    .sort((a, b) => (b.assignment.completed_at ?? b.assignment.updated_at).localeCompare(a.assignment.completed_at ?? a.assignment.updated_at));
  const skipped = items
    .filter((i) => !i.done && i.skipped)
    .sort((a, b) => cmp(b.skipped_at ?? '', a.skipped_at ?? '') || cmp(a.assignment.id, b.assignment.id));
  return { todo, done, skipped };
}

/** "Restaurant · day 1 of 2" → { base: 'Restaurant', part: 'day 1 of 2' } — the part goes on the meta line. */
export function titleParts(a: Pick<HomeworkAssignment, 'title' | 'part_index' | 'part_count'>): { base: string; part: string | null } {
  if (a.part_count <= 1) return { base: a.title, part: null };
  const part = `day ${a.part_index + 1} of ${a.part_count}`;
  const base = a.title.endsWith(` · ${part}`) ? a.title.slice(0, -` · ${part}`.length) : a.title;
  return { base, part };
}

/**
 * Lessons / readers assigned one-off only: they stay out of the study
 * session's lesson mix and the daily-reader pick (the pass is where they are
 * done). Any status — a finished or cancelled one-off never joins FSRS.
 */
export function oneOffOnlyTargets(list: Pick<HomeworkAssignment, 'mode' | 'target_id'>[]): Set<string> {
  const fsrs = new Set(list.filter((a) => a.mode !== 'one_off').map((a) => a.target_id));
  return new Set(list.filter((a) => a.mode === 'one_off' && !fsrs.has(a.target_id)).map((a) => a.target_id));
}

/**
 * Lessons / readers with a homework PASS (an assignment in `one_off` or `both` mode that wasn't
 * cancelled): the tutor's homework comes on top of the day's "New lessons a day" place — it
 * neither takes it while NEW nor uses it up when finished (`pickTodaysLessons`,
 * shared/study/revisit.ts). Once finished, a `both` lesson rotates on the "revisit later"
 * schedule like any other.
 */
export function homeworkPassTargets(list: Pick<HomeworkAssignment, 'mode' | 'target_id' | 'status'>[]): Set<string> {
  return new Set(list.filter((a) => a.mode !== 'fsrs' && a.status !== 'cancelled').map((a) => a.target_id));
}

const KIND_WORD: Record<string, string> = { lesson: 'mini lesson', reader: 'reader', link: 'link' };

/** The meta line of a homework row: "Day 1 of 2 · 3 of 12 words left · then long-term review · from 老师". */
export function homeworkRowDetail(item: HomeworkItemView, showTutor: boolean): string {
  const a = item.assignment;
  const { part } = titleParts(a);
  const progress = item.skipped ? 'skipped' : a.kind === 'deck' ? passSummary(item.progress, 'deck') : item.done ? 'done' : KIND_WORD[a.kind] ?? a.kind;
  const detail = part ? `${part.replace(/^d/, 'D')} · ${progress}` : progress;
  return detail + (a.mode === 'both' && !item.done && !item.skipped ? ' · then long-term review' : '') + (showTutor && a.tutor_name ? ` · from ${a.tutor_name}` : '');
}

export const KIND_ICON: Record<string, string> = { deck: '📚', lesson: '🎓', reader: '📖', link: '🔗' };

/**
 * The student's own status for an item — the same four as the tutor's library
 * (Completed / In progress / Overdue / Not started), from the pass on the device.
 */
export function itemStatus(item: HomeworkItemView, today: string): LibraryStatus {
  return libraryStatus({
    complete: item.done,
    skipped: item.skipped,
    started: item.progress.done > 0 || item.progress.retrying > 0,
    due_date: item.assignment.due_date,
    today,
  });
}
