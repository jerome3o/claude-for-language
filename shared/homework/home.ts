/**
 * The student Home's compact homework card: ONE slim row per active item — title, a progress
 * figure ("5 / 12") and a due label — instead of the old big "From <tutor>" card with buttons.
 * Pure, so the web (components/home/HomeworkHomeCard.tsx) and the Lab app (core
 * `HomeHomework.kt`, parity-tested through android-lab/parity/fixtures/homework.ts) show the
 * same rows, in the same order, and open the same screen on a tap.
 *
 * Rows:
 *  1. one-off / both assignments still to do (the pass): overdue first, then by due date —
 *     `sortHomeworkItems().todo`. A tap opens the pass `/homework/:id` (deck: the word pass;
 *     lesson / reader: the regular player inside the pass, which records the `done` event).
 *  2. mini lesson REVISIONS due today (shared/study/lessonRevision.ts — any lesson: the tutor's,
 *     his own, a podcast companion) → the revision run `/lessons/:id/play?from=home&mode=revision`.
 *  3. NEW mini lessons a TUTOR sent for long-term review with no open assignment row — the
 *     lesson entries of `longTerm` (an active fsrs-mode assignment, or the legacy "From <tutor>"
 *     pick of a lesson sent before assignments existed) → `/lessons/:id/play?from=home`. Oldest
 *     first; locked ones wait.
 *  NOT rows (Jerome, Oct 2026: "+23 more" counted things that aren't to-do): a lesson whose
 *  assignments were all CANCELLED (the tutor took it back; it is in no `todo` / `longTerm` list),
 *  and his own / agent-made / companion lessons never started — those stay on the Mini Lessons
 *  page (/lessons), which lists every lesson. A revision due (row 2) is a row whoever made it.
 *  Mini lessons are no longer mixed into the study session (Oct 2026): Home's card, /homework and
 *  the Mini Lessons page are where they are done. Anything covered by an earlier row is left out.
 *
 * `more` counts the rows past the limit; "+N more" opens /homework, which lists the same rows:
 * the assignments (To do) and the lesson rows (`homeHomeworkRows(...).filter(isLessonRow)`).
 *
 * Every row says how big it is (`size`, shared/homework/size.ts): "18 exercises · ~12 min",
 * "5 questions · ~4 min", "12 words", "6 pages".
 *
 * A long-term (fsrs-only) DECK is not a homework row any more (docs/HOMEWORK.md §11): it is a deck
 * in the student's queue — Home's "Next up" line and the Decks tab — not an item with an end.
 */

import type { DueLabel, DueTone } from './due';
import type { HomeworkItemView } from './items';
import type { HomeworkAssignment } from './types';
import { deckSizeLabel } from './size';

/** Long-term homework: an fsrs-mode assignment, or a deck / lesson a tutor sent before assignments existed. */
export interface LongTermHomework {
  kind: 'deck' | 'lesson';
  /** The student's copy (deck id / custom_lessons id). */
  target_id: string;
  title: string;
  tutor_name: string | null;
  /** ISO — when it was sent (newest first). */
  sent_at: string;
  /** Deck: words with at least one card out of NEW / all words. Null when unknown (not synced). */
  met: number | null;
  total: number | null;
}

export interface HomeHomeworkRow {
  /** Stable key: the assignment id, or "<kind>:<target_id>". */
  key: string;
  kind: string;
  icon: string;
  title: string;
  /** "5 / 12" (words), "lesson", "reader", "Revision 2", "new", "" when unknown. */
  progress: string;
  /** How big it is: "18 exercises · ~12 min", "5 questions · ~4 min", "12 words", "6 pages"; "" when unknown. */
  size: string;
  /** 0..1 for the thin bar; null = no bar (lessons / readers, unknown). */
  fraction: number | null;
  /** "overdue" · "due today" · "due tomorrow" · "due in 3 days" · "daily review" · "next session". */
  due: string;
  tone: DueTone;
  /** Where a tap goes — a web path; the Lab app opens web paths natively (LabNav). */
  route: string;
  tutor_name: string | null;
}

export interface HomeHomework {
  rows: HomeHomeworkRow[];
  /** Rows beyond the limit ("+2 more" → /homework). */
  more: number;
  /** "From 明慧老师" when every row (and the unread message) is from one tutor, else "Homework". */
  heading: string;
}

/** A mini lesson as Home's card sees it (its state from shared/study/lessonRevision.ts). */
export interface HomeLesson {
  id: string;
  title: string;
  created_at: string;
  status: 'new' | 'revision' | 'done';
  /** Waiting on its unlock condition (shared/lesson/unlock.ts): never on Home. */
  locked: boolean;
  /** A revision due by today's cutoff (`isRevisionDue`). */
  revision_due: boolean;
  /** The revision's number (1, 2…); 0 when not a revision. */
  revision: number;
  /** When the revision is due (ms) — the order of revision rows. */
  due_ms: number | null;
  /** "18 exercises · ~12 min" for a new lesson, "5 questions · ~4 min" for its revision. */
  size: string;
  tutor_name: string | null;
}

export const HOME_HOMEWORK_LIMIT = 4;

const ICON: Record<string, string> = { deck: '📚', lesson: '🎓', reader: '📖', link: '🔗', revision: '🔁' };

/** Where a tap on a mini lesson row goes: the run (its revision when one is due). */
export function lessonPlayRoute(lessonId: string, revision: boolean, from = 'home'): string {
  return `/lessons/${lessonId}/play?from=${from}${revision ? '&mode=revision' : ''}`;
}
const KIND_WORD: Record<string, string> = { lesson: 'lesson', reader: 'reader', link: 'link' };

/** The compact due label: "due in 1 day" reads as "due tomorrow" on Home. */
export function compactDue(due: DueLabel): string {
  if (due.days === 1) return 'due tomorrow';
  return due.text;
}

/** "5 / 12" words, or the kind's word for a lesson / reader. */
function oneOffProgress(item: HomeworkItemView): { progress: string; fraction: number | null } {
  const a = item.assignment;
  if (a.kind !== 'deck') return { progress: KIND_WORD[a.kind] ?? a.kind, fraction: null };
  const { done, total } = item.progress;
  return { progress: `${done} / ${total}`, fraction: total > 0 ? done / total : 0 };
}

/** The route a tap on an assignment row opens: always the pass (it hosts the lesson / reader player). */
export function assignmentRoute(a: Pick<HomeworkAssignment, 'id'>): string {
  return `/homework/${a.id}`;
}

export function longTermRoute(item: Pick<LongTermHomework, 'kind' | 'target_id'>): string {
  return item.kind === 'deck' ? `/decks/${item.target_id}` : '/lessons';
}

/** A long-term deck is still "active" on Home while some of its words have never been studied. */
export function longTermActive(item: LongTermHomework): boolean {
  if (item.kind !== 'deck') return true;
  if (item.met === null || item.total === null) return true;
  return item.total > 0 && item.met < item.total;
}

/**
 * Words met in a deck: notes with at least one card out of NEW (queue != 0), over all notes.
 * `cards` = the deck's cards, `noteIds` = the deck's notes.
 */
export function wordsMet(cards: ReadonlyArray<{ note_id: string; queue: number }>, noteIds: readonly string[]): { met: number; total: number } {
  const wanted = new Set(noteIds);
  const met = new Set<string>();
  for (const c of cards) if (c.queue !== 0 && wanted.has(c.note_id)) met.add(c.note_id);
  return { met: met.size, total: wanted.size };
}

/** A mini lesson row (revision due / new tutor-sent lesson), not an assignment row — /homework's "Mini lessons" section. */
export function isLessonRow(row: Pick<HomeHomeworkRow, 'key'>): boolean {
  return row.key.startsWith('revision:') || row.key.startsWith('lesson:');
}

/** Every row of the card, in order, before the limit (what "+N more" counts; /homework lists them). */
export function homeHomeworkRows(
  todo: readonly HomeworkItemView[],
  longTerm: readonly LongTermHomework[],
  opts: {
    /** Size labels of lessons / readers by target id (a deck part's size is its word count). */
    sizes?: Readonly<Record<string, string>>;
    /** Every mini lesson on the device (revisions due + new ones). */
    lessons?: readonly HomeLesson[];
  } = {}
): HomeHomeworkRow[] {
  const sizes = opts.sizes ?? {};
  const rows: HomeHomeworkRow[] = [];
  const covered = new Set<string>();

  for (const item of todo) {
    if (item.done) continue;
    const a = item.assignment;
    covered.add(a.target_id);
    const { progress, fraction } = oneOffProgress(item);
    rows.push({
      key: a.id,
      kind: a.kind,
      icon: ICON[a.kind] ?? '📝',
      title: a.title,
      progress,
      size: a.kind === 'deck' ? deckSizeLabel(item.progress.total) : sizes[a.target_id] ?? '',
      fraction,
      due: compactDue(item.due),
      tone: item.due.tone,
      route: assignmentRoute(a),
      tutor_name: a.tutor_name ?? null,
    });
  }

  // Lessons a tutor sent for long-term review (the only NEW lessons that are rows).
  const tutorOf = new Map<string, string | null>();
  for (const l of longTerm) if (l.kind === 'lesson') tutorOf.set(l.target_id, l.tutor_name);
  const lessons = (opts.lessons ?? []).filter((l) => !l.locked && !covered.has(l.id));
  const byCreated = (a: HomeLesson, b: HomeLesson) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const revisions = lessons
    .filter((l) => l.status === 'revision' && l.revision_due)
    .sort((a, b) => (a.due_ms ?? 0) - (b.due_ms ?? 0) || byCreated(a, b));
  for (const l of revisions) {
    covered.add(l.id);
    rows.push({
      key: `revision:${l.id}`,
      kind: 'revision',
      icon: ICON.revision,
      title: l.title,
      progress: l.revision > 0 ? `Revision ${l.revision}` : 'Revision',
      size: l.size,
      fraction: null,
      due: 'due today',
      tone: 'today',
      route: lessonPlayRoute(l.id, true),
      tutor_name: l.tutor_name ?? tutorOf.get(l.id) ?? null,
    });
  }
  const tutorNew = lessons.filter((x) => x.status === 'new' && !covered.has(x.id) && tutorOf.has(x.id)).sort(byCreated);
  for (const l of tutorNew) {
    covered.add(l.id);
    rows.push({
      key: `lesson:${l.id}`,
      kind: 'lesson',
      icon: ICON.lesson,
      title: l.title,
      progress: 'new',
      size: l.size,
      fraction: null,
      due: '',
      tone: 'none',
      route: lessonPlayRoute(l.id, false),
      tutor_name: l.tutor_name ?? tutorOf.get(l.id) ?? null,
    });
  }
  return rows;
}

export function homeHomework(
  todo: readonly HomeworkItemView[],
  longTerm: readonly LongTermHomework[],
  opts: {
    limit?: number;
    unreadFrom?: string | null;
    /** Size labels of lessons / readers by target id (a deck part's size is its word count). */
    sizes?: Readonly<Record<string, string>>;
    /** Every mini lesson on the device (revisions due + new ones). */
    lessons?: readonly HomeLesson[];
  } = {}
): HomeHomework {
  const limit = opts.limit ?? HOME_HOMEWORK_LIMIT;
  const rows = homeHomeworkRows(todo, longTerm, opts);
  const shown = rows.slice(0, limit);
  const names = new Set<string>();
  let anyOwn = false;
  for (const r of rows) {
    if (r.tutor_name) names.add(r.tutor_name);
    else anyOwn = true;
  }
  if (opts.unreadFrom) names.add(opts.unreadFrom);
  return {
    rows: shown,
    more: rows.length - shown.length,
    heading: names.size === 1 && !anyOwn ? `From ${[...names][0]}` : names.size === 0 && rows.length > 0 ? 'To do' : 'Homework',
  };
}
