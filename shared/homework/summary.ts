/**
 * The top-line homework figure (docs/HOMEWORK.md §11): ONE-OFF homework only.
 *
 * Jerome (Oct 2026) saw "Homework 13%" after doing every one-off item that week: the number was a
 * blend of how far he was through a long-term deck the FSRS budget will take months to introduce.
 * Long-term (fsrs-only) decks are not homework progress — they are decks in his queue — so the
 * headline counts the one-off pass of `one_off` and `both` assignments and nothing else:
 *
 *  - open = active one-off assignments (any due date; overdue ones stay open until done);
 *  - done = one-off assignments finished in the last `SUMMARY_WINDOW_DAYS` days (by completed_at,
 *    or due_date when the completion time is unknown), so "2 of 3 done" is about this week and
 *    does not grow forever;
 *  - nothing open → "✓ All done" (this week when something was finished recently); nothing one-off
 *    ever sent → "No homework set". Never "0%".
 *
 * Pure: the worker puts it on the student overview (`pills.homework`, `homework.one_off`) and the
 * web / Lab dashboards and the MCP tools show its words.
 */

import { addDays, daysBetween } from './due';
import { hasOneOff, type HomeworkMode, type HomeworkStatus } from './types';

export const SUMMARY_WINDOW_DAYS = 7;

export interface OneOffSummaryInput {
  mode: HomeworkMode;
  status: HomeworkStatus;
  due_date: string | null;
  completed_at: string | null;
}

/** none = nothing one-off ever set · all_done = nothing open · open · overdue = something open is past its due date. */
export type OneOffState = 'none' | 'all_done' | 'open' | 'overdue';

export interface OneOffSummary {
  state: OneOffState;
  /** open + done this week. */
  total: number;
  /** Finished in the window. */
  done: number;
  open: number;
  overdue: number;
  due_today: number;
  /** done / total (0..100); 100 when all done; null when nothing was ever set. */
  percent: number | null;
  /** "✓ All done this week" · "2 of 3 done" · "1 overdue · 2 of 3 done" · "No homework set". */
  label: string;
  /** The same for a pill: "Homework ✓ all done this week" · "Homework 2 of 3 done" · "Homework 1 overdue". */
  pill: string;
}

function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}

export function summarizeOneOffHomework(
  assignments: readonly OneOffSummaryInput[],
  today: string,
  windowDays: number = SUMMARY_WINDOW_DAYS
): OneOffSummary {
  const since = addDays(today, -(windowDays - 1));
  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  let doneRecent = 0;
  let doneEver = 0;
  for (const a of assignments) {
    if (!hasOneOff(a.mode) || a.status === 'cancelled') continue;
    if (a.status === 'done') {
      doneEver++;
      const day = dayOf(a.completed_at) ?? a.due_date;
      if (day && day >= since) doneRecent++;
      continue;
    }
    open++;
    if (a.due_date) {
      const d = daysBetween(today, a.due_date);
      if (d < 0) overdue++;
      else if (d === 0) dueToday++;
    }
  }

  const total = open + doneRecent;
  const base = { total, done: doneRecent, open, overdue, due_today: dueToday };
  if (open === 0 && doneEver === 0) {
    return { ...base, state: 'none', percent: null, label: 'No homework set', pill: 'No homework set' };
  }
  if (open === 0) {
    const label = doneRecent > 0 ? '✓ All done this week' : '✓ All done';
    return { ...base, state: 'all_done', percent: 100, label, pill: `Homework ${label.replace('All', 'all')}` };
  }
  const percent = Math.round((100 * doneRecent) / total);
  const progress = `${doneRecent} of ${total} done`;
  if (overdue > 0) {
    return { ...base, state: 'overdue', percent, label: `${overdue} overdue · ${progress}`, pill: `Homework ${overdue} overdue` };
  }
  return { ...base, state: 'open', percent, label: progress, pill: `Homework ${progress}` };
}

/**
 * Is a deck the tutor sent part of the student's long-term learning? Yes unless every assignment
 * on that copy is one-off only (that copy is capped at 0 + 0 and lives in the pass). A share with
 * no assignments (sent before assignments existed) is long-term.
 */
export function isLongTermDeck(modes: readonly HomeworkMode[]): boolean {
  return modes.length === 0 || modes.some((m) => m !== 'one_off');
}
