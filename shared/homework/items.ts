/**
 * What the student's homework screens show, computed from the mirrored
 * assignments and the pass events (docs/HOMEWORK.md §3). Pure — the web app's
 * services/homework.ts and the Lab app (android-lab core `HomeworkItems.kt`,
 * parity-tested) both use these rules.
 */

import { compareDue, dueLabel, type DueLabel } from './due';
import { passProgress, passSummary, type PassProgress } from './pass';
import { passItemIds, type HomeworkAssignment, type HomeworkEvent } from './types';

export interface HomeworkItemView<A extends HomeworkAssignment = HomeworkAssignment> {
  assignment: A;
  progress: PassProgress;
  due: DueLabel;
  /** Done on this device or on the server. */
  done: boolean;
}

/** One-off assignments (not fsrs-only, not cancelled) with their pass progress and due label. */
export function toHomeworkItems<A extends HomeworkAssignment>(
  assignments: A[],
  events: Pick<HomeworkEvent, 'assignment_id' | 'item_id' | 'result' | 'created_at'>[],
  today: string
): HomeworkItemView<A>[] {
  const byAssignment = new Map<string, Pick<HomeworkEvent, 'assignment_id' | 'item_id' | 'result' | 'created_at'>[]>();
  for (const e of events) {
    const list = byAssignment.get(e.assignment_id) ?? [];
    list.push(e);
    byAssignment.set(e.assignment_id, list);
  }
  return assignments
    .filter((a) => a.mode !== 'fsrs' && a.status !== 'cancelled')
    .map((a) => {
      const progress = passProgress(passItemIds(a), byAssignment.get(a.id) ?? []);
      const done = a.status === 'done' || progress.complete;
      return { assignment: a, progress, due: dueLabel(a.due_date, today), done };
    });
}

/** To do first: overdue, then by due date, then by part; done ones newest first. */
export function sortHomeworkItems<A extends HomeworkAssignment>(items: HomeworkItemView<A>[]): { todo: HomeworkItemView<A>[]; done: HomeworkItemView<A>[] } {
  const todo = items
    .filter((i) => !i.done)
    .sort((a, b) => compareDue(a.assignment.due_date, b.assignment.due_date) || a.assignment.part_index - b.assignment.part_index || a.assignment.created_at.localeCompare(b.assignment.created_at));
  const done = items
    .filter((i) => i.done)
    .sort((a, b) => (b.assignment.completed_at ?? b.assignment.updated_at).localeCompare(a.assignment.completed_at ?? a.assignment.updated_at));
  return { todo, done };
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

const KIND_WORD: Record<string, string> = { lesson: 'mini lesson', reader: 'reader' };

/** The meta line of a homework row: "Day 1 of 2 · 3 of 12 words left · then long-term review · from 老师". */
export function homeworkRowDetail(item: HomeworkItemView, showTutor: boolean): string {
  const a = item.assignment;
  const { part } = titleParts(a);
  const progress = a.kind === 'deck' ? passSummary(item.progress, 'deck') : item.done ? 'done' : KIND_WORD[a.kind] ?? a.kind;
  const detail = part ? `${part.replace(/^d/, 'D')} · ${progress}` : progress;
  return detail + (a.mode === 'both' && !item.done ? ' · then long-term review' : '') + (showTutor && a.tutor_name ? ` · from ${a.tutor_name}` : '');
}

export const KIND_ICON: Record<string, string> = { deck: '📚', lesson: '🎓', reader: '📖' };
