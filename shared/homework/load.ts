/**
 * The load gauge: how much homework the student already has, so a tutor can
 * cut back before assigning more. Two halves:
 * - one-off: pending passes (words left in deck passes, lessons / readers not
 *   done), how many are overdue, due today, and per day for the next week;
 * - long-term: words still to be introduced by the FSRS queue and ~days at the
 *   student's daily new-word budget.
 *
 * Thresholds for the light / moderate / heavy level are deliberately simple
 * (see LOAD_THRESHOLDS) — they are a nudge, not a rule.
 */

import { addDays, daysBetween } from './due';
import { hasOneOff, type HomeworkMode, type HomeworkStatus, type HomeworkKind } from './types';

export interface LoadAssignmentInput {
  kind: HomeworkKind;
  mode: HomeworkMode;
  status: HomeworkStatus;
  due_date: string | null;
  item_count: number;
  done_count: number;
}

export interface LoadInput {
  assignments: readonly LoadAssignmentInput[];
  today: string;
  /** Unseen words across the student's decks the FSRS budget will still introduce. */
  fsrsWordsToGo: number;
  /** The student's daily budget of brand-new words. */
  newPerDay: number;
}

export type LoadLevel = 'light' | 'moderate' | 'heavy';

export interface LoadDay {
  date: string;
  items: number;
  words: number;
}

export interface HomeworkLoad {
  one_off: {
    /** Pending one-off assignments (deck parts, lessons, readers). */
    items: number;
    /** Words left across pending deck passes. */
    words: number;
    /** Pending lessons / readers. */
    other: number;
    overdue_items: number;
    overdue_words: number;
    due_today_items: number;
    /** Today and the next six days (overdue counted separately). */
    by_day: LoadDay[];
  };
  fsrs: {
    words_to_go: number;
    days_to_go: number;
    new_per_day: number;
  };
  level: LoadLevel;
  /** One line for the tutor. */
  summary: string;
}

export const LOAD_THRESHOLDS = {
  heavy: { overdueItems: 2, oneOffWords: 40, fsrsDays: 30 },
  moderate: { overdueItems: 1, oneOffWords: 15, oneOffItems: 4, fsrsDays: 10 },
} as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function computeHomeworkLoad(input: LoadInput): HomeworkLoad {
  const days: LoadDay[] = Array.from({ length: 7 }, (_, i) => ({ date: addDays(input.today, i), items: 0, words: 0 }));
  let items = 0;
  let words = 0;
  let other = 0;
  let overdueItems = 0;
  let overdueWords = 0;
  let dueToday = 0;

  for (const a of input.assignments) {
    if (a.status !== 'active' || !hasOneOff(a.mode)) continue;
    const left = Math.max(0, a.item_count - a.done_count);
    if (left === 0) continue;
    const isDeck = a.kind === 'deck';
    items += 1;
    if (isDeck) words += left;
    else other += 1;
    if (!a.due_date) continue;
    const d = daysBetween(input.today, a.due_date);
    if (d < 0) {
      overdueItems += 1;
      if (isDeck) overdueWords += left;
    } else {
      if (d === 0) dueToday += 1;
      if (d < days.length) {
        days[d].items += 1;
        if (isDeck) days[d].words += left;
      }
    }
  }

  const perDay = Math.max(0, Math.round(input.newPerDay));
  const toGo = Math.max(0, Math.round(input.fsrsWordsToGo));
  const daysToGo = toGo === 0 ? 0 : perDay === 0 ? 999 : Math.ceil(toGo / perDay);

  const h = LOAD_THRESHOLDS.heavy;
  const m = LOAD_THRESHOLDS.moderate;
  const level: LoadLevel =
    overdueItems >= h.overdueItems || words >= h.oneOffWords || daysToGo >= h.fsrsDays
      ? 'heavy'
      : overdueItems >= m.overdueItems || words >= m.oneOffWords || items >= m.oneOffItems || daysToGo >= m.fsrsDays
        ? 'moderate'
        : 'light';

  const parts: string[] = [];
  if (items === 0) parts.push('No one-off homework pending');
  else {
    const bits = [words > 0 ? plural(words, 'word') : null, other > 0 ? plural(other, 'lesson / reader') : null].filter(Boolean);
    parts.push(`${plural(items, 'one-off item')} pending (${bits.join(', ')})`);
  }
  if (overdueItems > 0) parts.push(`${overdueItems} overdue`);
  parts.push(toGo === 0 ? 'nothing waiting in long-term review' : `${plural(toGo, 'word')} to go in long-term review (~${daysToGo} ${daysToGo === 1 ? 'day' : 'days'} at ${perDay}/day)`);

  return {
    one_off: { items, words, other, overdue_items: overdueItems, overdue_words: overdueWords, due_today_items: dueToday, by_day: days },
    fsrs: { words_to_go: toGo, days_to_go: daysToGo, new_per_day: perDay },
    level,
    summary: parts.join(' · '),
  };
}
