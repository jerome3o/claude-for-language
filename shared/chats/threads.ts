/**
 * Ask-Claude questions are stored one row per question/answer pair
 * (`note_questions`). For a listing, consecutive questions about the same card
 * within a short gap read as ONE conversation ("the three things I asked about
 * 银行 on Tuesday"). This groups rows into those threads. Pure.
 */

export interface QuestionRow {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  /** ISO timestamp */
  asked_at: string;
}

export interface QuestionThread<T extends QuestionRow = QuestionRow> {
  /** The first question's id — stable for React keys and deep links. */
  id: string;
  note_id: string;
  /** Oldest first, so the thread reads top to bottom. */
  questions: T[];
  started_at: string;
  last_at: string;
}

/** Two questions on the same card closer than this belong to one thread. */
export const THREAD_GAP_MS = 30 * 60 * 1000;

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Group rows (any order) into threads, newest thread first. A thread is one
 * note's questions where each is within `gapMs` of the previous one.
 */
export function groupQuestionThreads<T extends QuestionRow>(rows: T[], gapMs = THREAD_GAP_MS): QuestionThread<T>[] {
  const sorted = [...rows].sort((a, b) => time(a.asked_at) - time(b.asked_at));
  const open = new Map<string, QuestionThread<T>>();
  const threads: QuestionThread<T>[] = [];
  for (const row of sorted) {
    const current = open.get(row.note_id);
    if (current && time(row.asked_at) - time(current.last_at) <= gapMs) {
      current.questions.push(row);
      current.last_at = row.asked_at;
      continue;
    }
    const thread: QuestionThread<T> = {
      id: row.id,
      note_id: row.note_id,
      questions: [row],
      started_at: row.asked_at,
      last_at: row.asked_at,
    };
    open.set(row.note_id, thread);
    threads.push(thread);
  }
  return threads.sort((a, b) => time(b.last_at) - time(a.last_at));
}

/** SQLite's datetime('now') ("2026-09-25 10:01:02") as ISO; ISO input passes through. */
export function sqliteToIso(value: string): string {
  if (!value) return value;
  if (value.includes('T')) return value;
  return value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z');
}
