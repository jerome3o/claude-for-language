/**
 * Grammar Study Service
 *
 * Grammar lessons are precomputed server-side (~6 ahead), cached in
 * IndexedDB, and studied fully offline at the end of the study session
 * (after the graded reader), one lesson per day.
 *
 * - Content: GET /api/practice/upcoming returns the next lessons with
 *   pre-generated exercises; missing ones are generated in the background
 *   server-side and arrive on a later sync.
 * - Completions: recorded locally as events and uploaded via
 *   POST /api/practice/offline-complete (idempotent by event id). The server
 *   applies them to grammar_progress, which drives which lessons come next.
 *
 * Exercises that used to need AI (translation checking, spoken production
 * checking) are self-assessed offline: the learner reveals the reference
 * answer / example variations and judges themselves.
 */

import {
  db,
  LocalGrammarLesson,
  LocalGrammarCompletionEvent,
} from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';
import { prefetchTTS } from './ttsCache';

/** A lesson graduates to 'known' after this many cumulative correct answers
 * (matches the server-side grammar_progress rule). */
export const GRAMMAR_KNOWN_THRESHOLD = 8;

/**
 * Master switch: grammar lessons are benched from the study session for now
 * (Jerome finds them weak as-is; custom mini lessons cover the ground
 * better). The code all stays for a future revamp — flip this to bring them
 * back. Also gates the background sync, which matters because the
 * /api/practice/upcoming call is what kicks off server-side exercise
 * generation (real AI cost).
 */
export const GRAMMAR_LESSONS_ENABLED = false;

interface UpcomingLessonResponse {
  lessons: Array<{
    grammar_point: {
      id: string;
      level: string;
      title: string;
      pattern: string;
      explanation: string;
      cgw_url: string | null;
      seed_examples: LocalGrammarLesson['seed_examples'];
      order_index: number;
    };
    progress: { status: 'new' | 'learning' | 'known'; correct_count: number } | null;
    exercises: NonNullable<LocalGrammarLesson['exercises']> | null;
  }>;
}

function isSameLocalDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Whether a grammar lesson was already completed today (learner-local time).
 * Timestamps are stored as UTC ISO strings, so compare parsed local dates —
 * a prefix match on the string would use the UTC date and, in timezones
 * ahead of UTC, hand out a second lesson on the same local day. */
export async function grammarCompletedToday(): Promise<boolean> {
  const events = await db.grammarCompletionEvents.toArray();
  return events.some(e => isSameLocalDay(e.completed_at));
}

/**
 * True when the lesson queue is known but no lesson has exercises yet —
 * generation is in flight server-side (kicked off by the upcoming call) and
 * a sync poll should land today's lesson shortly.
 */
export async function grammarGenerationPending(): Promise<boolean> {
  if (await grammarCompletedToday()) return false;
  const lessons = await db.grammarLessons.toArray();
  const usable = lessons.some(l => l.exercises !== null && l.status !== 'known');
  const awaiting = lessons.some(l => l.exercises === null && l.status !== 'known');
  return !usable && awaiting;
}

/**
 * Push unsynced completion events, then pull the upcoming lesson queue.
 * Upload happens first so the server's idea of progress (and therefore the
 * lesson order it returns) includes offline completions.
 */
export async function syncGrammarLessons(): Promise<{ synced: number }> {
  await uploadGrammarCompletions();

  const response = await fetch(`${API_BASE}/api/practice/upcoming`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch upcoming grammar lessons: ${response.status}`);
  }
  const data = await response.json() as UpcomingLessonResponse;

  const rows: LocalGrammarLesson[] = data.lessons.map((lesson, index) => ({
    grammar_point_id: lesson.grammar_point.id,
    level: lesson.grammar_point.level,
    title: lesson.grammar_point.title,
    pattern: lesson.grammar_point.pattern,
    explanation: lesson.grammar_point.explanation,
    cgw_url: lesson.grammar_point.cgw_url,
    seed_examples: lesson.grammar_point.seed_examples,
    order_index: lesson.grammar_point.order_index,
    position: index,
    status: lesson.progress?.status ?? 'new',
    correct_count: lesson.progress?.correct_count ?? 0,
    exercises: lesson.exercises,
    _synced_at: Date.now(),
  }));

  await db.transaction('rw', db.grammarLessons, async () => {
    await db.grammarLessons.clear();
    await db.grammarLessons.bulkPut(rows);
  });

  return { synced: rows.length };
}

/** Upload unsynced completion events (idempotent server-side by event id). */
export async function uploadGrammarCompletions(): Promise<{ uploaded: number }> {
  const unsynced = await db.grammarCompletionEvents.where('_synced').equals(0).toArray();
  if (unsynced.length === 0) return { uploaded: 0 };

  const response = await fetch(`${API_BASE}/api/practice/offline-complete`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: unsynced.map(e => ({
        id: e.id,
        grammar_point_id: e.grammar_point_id,
        correct: e.correct,
        total: e.total,
        completed_at: e.completed_at,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to upload grammar completions: ${response.status}`);
  }

  await db.grammarCompletionEvents.where('id').anyOf(unsynced.map(e => e.id)).modify({ _synced: 1 });
  return { uploaded: unsynced.length };
}

/**
 * Today's grammar lesson, or null when done for today / nothing cached.
 * One lesson per day: any completion event dated today means no more grammar.
 */
export async function getTodaysGrammarLesson(): Promise<LocalGrammarLesson | null> {
  if (await grammarCompletedToday()) return null;

  const lessons = await db.grammarLessons.orderBy('position').toArray();
  return lessons.find(l => l.exercises !== null && l.status !== 'known') ?? null;
}

/**
 * Record a completed lesson: append the completion event (synced up later)
 * and update the cached lesson's progress so the local queue stays coherent
 * until the next server sync.
 */
export async function completeGrammarLesson(
  grammarPointId: string,
  correct: number,
  total: number
): Promise<LocalGrammarCompletionEvent> {
  const event: LocalGrammarCompletionEvent = {
    id: crypto.randomUUID(),
    grammar_point_id: grammarPointId,
    correct,
    total,
    completed_at: new Date().toISOString(),
    _synced: 0,
  };
  await db.grammarCompletionEvents.put(event);

  const lesson = await db.grammarLessons.get(grammarPointId);
  if (lesson) {
    const newCorrectCount = lesson.correct_count + correct;
    await db.grammarLessons.update(grammarPointId, {
      correct_count: newCorrectCount,
      status: newCorrectCount >= GRAMMAR_KNOWN_THRESHOLD ? 'known' : 'learning',
    });
  }

  return event;
}

/**
 * Cache TTS for the next lessons' sentences so grammar audio works offline.
 * Covers the first two upcoming lessons (~25 short clips, one-time cost).
 */
export async function prefetchGrammarMedia(): Promise<void> {
  if (!navigator.onLine) return;

  const lessons = (await db.grammarLessons.orderBy('position').toArray())
    .filter(l => l.exercises !== null && l.status !== 'known')
    .slice(0, 2);

  for (const lesson of lessons) {
    const ex = lesson.exercises!;
    const texts = [
      ...ex.flood.map(e => e.hanzi),
      ...ex.scrambles.map(s => s.correct_order.join('')),
      ...ex.contrasts.flatMap(ct => [
        ct.option_a.hanzi,
        ct.option_b.hanzi,
        ...(ct.option_c ? [ct.option_c.hanzi] : []),
        ...(ct.option_d ? [ct.option_d.hanzi] : []),
      ]),
      ...ex.translates.map(t => t.reference_hanzi),
      ...lesson.seed_examples.map(e => e.hanzi),
    ];
    await prefetchTTS(texts);
  }
}
