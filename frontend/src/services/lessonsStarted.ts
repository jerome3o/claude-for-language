/**
 * Mini lessons opened today on this device (localStorage, per-device convenience).
 *
 * Opening a NEW lesson makes it today's lesson: if something else is finished afterwards
 * (another lesson from the Mini Lessons page, say), the lesson that was opened and left
 * half-way still comes back today instead of vanishing (`pickNewLessonsForToday`'s
 * `startedToday`, shared/study/revisit.ts). Finishing it simply makes it not-new any more,
 * so nothing has to be cleared. Old days are dropped on every write.
 */

const KEY = 'lessons-started-v1';

function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A real run of `lessonId` started (session, homework pass, Mini Lessons page). Never for previews. */
export function markLessonStarted(lessonId: string, now: Date = new Date()): void {
  const today = localDay(now);
  const kept: Record<string, string> = {};
  for (const [id, day] of Object.entries(read())) if (day === today) kept[id] = day;
  kept[lessonId] = today;
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* storage blocked: the lesson just isn't pinned */
  }
}

/** Lessons opened on today's local date. */
export function lessonsStartedToday(now: Date = new Date()): Set<string> {
  const today = localDay(now);
  return new Set(Object.entries(read()).filter(([, day]) => day === today).map(([id]) => id));
}
