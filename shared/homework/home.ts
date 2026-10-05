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
 *  2. a lesson the tutor sent outside an assignment (or for long-term review only) → `/lessons`
 *     (it comes up in the study session). Newest first. Anything already covered by a row of
 *     group 1 (same target) is left out.
 *
 * A long-term (fsrs-only) DECK is not a homework row any more (docs/HOMEWORK.md §11): it is a deck
 * in the student's queue — Home's "Next up" line and the Decks tab — not an item with an end.
 */

import type { DueLabel, DueTone } from './due';
import type { HomeworkItemView } from './items';
import type { HomeworkAssignment } from './types';

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
  /** "5 / 12" (words), "lesson", "reader", "" when unknown. */
  progress: string;
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

export const HOME_HOMEWORK_LIMIT = 4;

const ICON: Record<string, string> = { deck: '📚', lesson: '🎓', reader: '📖', link: '🔗' };
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

export function homeHomework(
  todo: readonly HomeworkItemView[],
  longTerm: readonly LongTermHomework[],
  opts: { limit?: number; unreadFrom?: string | null } = {}
): HomeHomework {
  const limit = opts.limit ?? HOME_HOMEWORK_LIMIT;
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
      fraction,
      due: compactDue(item.due),
      tone: item.due.tone,
      route: assignmentRoute(a),
      tutor_name: a.tutor_name ?? null,
    });
  }

  const seen = new Set<string>();
  const extra = longTerm
    .filter((l) => l.kind !== 'deck' && !covered.has(l.target_id) && longTermActive(l))
    .slice()
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : a.sent_at > b.sent_at ? -1 : 0));
  for (const l of extra) {
    const key = `${l.kind}:${l.target_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const known = l.kind === 'deck' && l.met !== null && l.total !== null;
    rows.push({
      key,
      kind: l.kind,
      icon: ICON[l.kind] ?? '📝',
      title: l.title,
      progress: known ? `${l.met} / ${l.total}` : l.kind === 'lesson' ? 'lesson' : '',
      fraction: known ? (l.total! > 0 ? l.met! / l.total! : 0) : null,
      due: l.kind === 'deck' ? 'daily review' : 'next session',
      tone: 'none',
      route: longTermRoute(l),
      tutor_name: l.tutor_name,
    });
  }

  const shown = rows.slice(0, limit);
  const names = new Set<string>();
  for (const r of rows) if (r.tutor_name) names.add(r.tutor_name);
  if (opts.unreadFrom) names.add(opts.unreadFrom);
  return {
    rows: shown,
    more: rows.length - shown.length,
    heading: names.size === 1 ? `From ${[...names][0]}` : 'Homework',
  };
}
