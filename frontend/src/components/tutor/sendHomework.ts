/**
 * Pure pieces of the Send homework sheet (SendHomeworkSheet.tsx): what it
 * starts with and the sentences it shows. docs/HOMEWORK.md "Defaults".
 */
import { DEFAULT_SEND_MODE, defaultHomeworkDueDate, hasOneOff, lessonDay, shortDay, type HomeworkMode } from '@shared/homework';

export interface SendDefaults {
  mode: HomeworkMode;
  /** The due date the picker starts on. */
  dueDate: string;
  /** The next logged lesson when that is what the due date is, for the "Next lesson" chip. */
  nextLesson: string | null;
}

/**
 * The sheet opens on Both (a one-off pass by a date, then long-term review),
 * due at the student's next logged lesson, else in two days.
 */
export function sendDefaults(today: string, lessonLog: ReadonlyArray<{ lesson_at: string }> = []): SendDefaults {
  const days = lessonLog.map((e) => lessonDay(e.lesson_at));
  const dueDate = defaultHomeworkDueDate(today, days);
  return { mode: DEFAULT_SEND_MODE, dueDate, nextLesson: days.includes(dueDate) ? dueDate : null };
}

export interface SendChoice {
  mode: HomeworkMode;
  dueDate: string;
  splitDays: number;
  priority: 'core' | 'non_urgent';
}

/** How it went out, for "Sent X to Y <how>." */
export function sendHow(kind: 'deck' | 'lesson', c: SendChoice): string {
  const queue = c.priority === 'core' ? 'the top of their queue' : 'the bottom of their queue';
  if (!hasOneOff(c.mode)) {
    if (kind === 'lesson') return 'in their long-term review';
    return c.priority === 'core' ? 'at the top of their queue, so their new words come from it next' : 'at the bottom of their queue, after everything they already have';
  }
  const due = c.splitDays > 1 && kind === 'deck' ? `over ${c.splitDays} days from ${shortDay(c.dueDate)}` : `by ${shortDay(c.dueDate)}`;
  if (c.mode === 'one_off') return `as one-off homework ${due}`;
  return `as one-off homework ${due}, then in long-term review${kind === 'deck' ? ` (${queue})` : ''}`;
}

/** Where an assigned lesson shows up, for the confirm step. */
export function lessonWhere(mode: HomeworkMode): string {
  if (mode === 'one_off') return ' in their homework list';
  if (mode === 'both') return ' in their homework list, then in their study sessions';
  return ', mixed into their next study session';
}
