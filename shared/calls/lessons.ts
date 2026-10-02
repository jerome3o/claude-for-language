/**
 * Lessons: the calls between the same two people (a tutor relationship — or,
 * for a solo test call, one person) that follow each other within
 * LESSON_GAP_MS count as ONE lesson. On 2 Oct 2026 one lesson became four
 * calls (leaving to switch device ended it; a network freeze; an accidental
 * call): the review page, the report and "Make homework" now work on the
 * lesson, so the tutor sees one lesson and makes its homework once.
 *
 * Rule: a call belongs to the lesson of the call before it (same people) when
 * it STARTS no later than LESSON_GAP_MS after that call ENDED (or while it is
 * still live); otherwise it starts a new lesson. The worker applies it when a
 * call is created (`lessonForNewCall` in services/calls/lessons.ts) and the
 * migration back-filled existing calls with the same rule; clients group the
 * Past calls list by the `lesson_id` the server sends (`groupCallsByLesson`).
 */

export const LESSON_GAP_MS = 20 * 60_000;

export interface LessonCallLike {
  id: string;
  /** Who the call is between: the relationship id, or `solo:<user id>`. */
  scope: string;
  /** ms since epoch. */
  start: number;
  /** ms since epoch; null while the call is live. */
  end: number | null;
}

/** Does a call starting at `start` continue a lesson whose latest call ended at `lastEnd` (null = still live)? */
export function continuesLesson(lastEnd: number | null, start: number): boolean {
  return lastEnd === null || start - lastEnd <= LESSON_GAP_MS;
}

/**
 * Group calls into lessons by the rule above. Returns lesson id (= the id of
 * its first call) per call id. Calls are taken in start order within a scope;
 * a live call keeps its lesson open.
 */
export function groupIntoLessons(calls: readonly LessonCallLike[]): Map<string, string> {
  const out = new Map<string, string>();
  const byScope = new Map<string, LessonCallLike[]>();
  for (const c of calls) byScope.set(c.scope, [...(byScope.get(c.scope) ?? []), c]);
  for (const list of byScope.values()) {
    list.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
    let lesson: string | null = null;
    let lastEnd: number | null = 0;
    for (const c of list) {
      if (lesson === null || !continuesLesson(lastEnd, c.start)) {
        lesson = c.id;
        lastEnd = c.end;
      } else if (lastEnd !== null) lastEnd = c.end === null ? null : Math.max(lastEnd, c.end);
      out.set(c.id, lesson);
    }
  }
  return out;
}

/** Is a lesson still open for a new call (its last call ended under LESSON_GAP_MS ago, or one is live)? */
export function lessonOpen(lastEnd: number | null, anyLive: boolean, now: number): boolean {
  return anyLive || (lastEnd !== null && now - lastEnd <= LESSON_GAP_MS);
}

/** A list row with its lesson. */
export interface CallWithLesson {
  id: string;
  lesson_id?: string | null;
  created_at: string;
}

/**
 * The Past calls list: one entry per lesson (newest lesson first), its calls
 * oldest first inside. Calls without a lesson id stand alone.
 */
export function groupCallsByLesson<T extends CallWithLesson>(calls: readonly T[]): { lessonId: string; calls: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const c of calls) {
    const key = c.lesson_id || `call:${c.id}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out = [...groups.entries()].map(([lessonId, list]) => ({
    lessonId,
    calls: [...list].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
  }));
  const newest = (g: { calls: T[] }) => g.calls[g.calls.length - 1].created_at;
  return out.sort((a, b) => (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0));
}
