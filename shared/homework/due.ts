/**
 * Due dates are calendar days ('YYYY-MM-DD') in the student's own time zone,
 * so "due today" means the same day on every device and no clock maths leaks
 * into the labels. All arithmetic here is on date strings (UTC noon), never on
 * local timestamps.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today (or `date`) as a local calendar day. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export interface DueLabel {
  /** "overdue", "due today", "due in 1 day", "due in 4 days", or "" without a date. */
  text: string;
  tone: DueTone;
  /** Days from today to the due date (negative when overdue); null without a date. */
  days: number | null;
}

/** The label a student (and the tutor) sees for a due date. */
export function dueLabel(due: string | null | undefined, today: string): DueLabel {
  if (!due || !isDateString(due)) return { text: '', tone: 'none', days: null };
  const days = daysBetween(today, due);
  if (days < 0) return { text: 'overdue', tone: 'overdue', days };
  if (days === 0) return { text: 'due today', tone: 'today', days };
  return { text: `due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: days <= 2 ? 'soon' : 'later', days };
}

/** Earliest due first; undated last. */
export function compareDue(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** "Tue 14 Oct" for a date string, in the viewer's locale-free short form. */
export function shortDay(date: string): string {
  if (!isDateString(date)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${month}`;
}
