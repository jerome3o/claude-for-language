/**
 * Leaving Study never ends anything (docs/STUDY_SESSION.md "Today is the session"): this keeps
 * what must survive the study screen unmounting — going to the Sentence Coach and back, ✕ to
 * Home and back, or a reload.
 *
 * - The resume point (`shared/study/resume.ts`): the card on screen, whether it was revealed,
 *   the typed answer, the time spent on it — in localStorage, so a reload keeps it too.
 * - The card's extras that can't go in localStorage — the recording blob and the multiple-choice
 *   grid as answered — in memory (they survive in-app navigation, not a reload).
 * - The undo snapshot, in memory for the rest of the day (per scope).
 * - The celebration mark (`shared/study/celebration.ts`), in localStorage.
 */

import {
  celebrationMark,
  shouldCelebrate,
  type CelebrationMark,
  type StudyResumePoint,
} from '@shared/study';
import { getLocalDateString } from '../api/client';

const POINT_KEY = 'study-resume-v1';
const CELEBRATION_KEY = 'study-celebrated-v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: in-app navigation still works from memory
  }
}

/** The multiple-choice grid as it stood (rows in the order shown, picks, answered). */
export interface ResumeMcState<Row = unknown> {
  rows: Row[];
  selections: (string | null)[];
  answered: boolean;
}

export interface ResumeExtras {
  cardId: string;
  recording?: Blob | null;
  mc?: ResumeMcState | null;
}

let memoryPoint: StudyResumePoint | null = null;
let extras: ResumeExtras | null = null;
let undo: { day: string; scope: string; snapshot: unknown } | null = null;

export function loadResumePoint(): StudyResumePoint | null {
  return memoryPoint ?? read<StudyResumePoint>(POINT_KEY);
}

export function saveResumePoint(point: StudyResumePoint): void {
  memoryPoint = point;
  write(POINT_KEY, point);
}

/** The card was rated (or removed): nothing to resume until the next card saves its own point. */
export function clearResumePoint(cardId?: string): void {
  const p = loadResumePoint();
  if (cardId && p && p.card_id !== cardId) return;
  memoryPoint = null;
  write(POINT_KEY, null);
  if (!cardId || extras?.cardId === cardId) extras = null;
}

export function resumeExtras(cardId: string): ResumeExtras | null {
  return extras?.cardId === cardId ? extras : null;
}

export function saveResumeExtras(next: ResumeExtras): void {
  extras = next;
}

/** Today's undo snapshot for [scope] (in memory only). */
export function loadUndoSnapshot<T>(scope: string): T | null {
  if (!undo || undo.scope !== scope || undo.day !== getLocalDateString()) return null;
  return undo.snapshot as T;
}

export function saveUndoSnapshot(scope: string, snapshot: unknown | null): void {
  undo = snapshot == null ? null : { day: getLocalDateString(), scope, snapshot };
}

/**
 * True when emptying the queue right now deserves the confetti (once a day, again after more
 * cards became due and were cleared) — and marks it, so the next call says false.
 */
export function claimCelebration(reviewsToday: number, queueEmpty: boolean): boolean {
  const day = getLocalDateString();
  const mark = read<CelebrationMark>(CELEBRATION_KEY);
  if (!shouldCelebrate(mark, day, reviewsToday, queueEmpty)) return false;
  write(CELEBRATION_KEY, celebrationMark(day, reviewsToday));
  return true;
}

const COACH_RETURN_KEY = 'coach-return-to';

/** Study → Sentence coach: where the coach's "← Back to your card" goes (this tab only). */
export function setCoachReturn(path: string | null): void {
  try {
    if (path) sessionStorage.setItem(COACH_RETURN_KEY, path);
    else sessionStorage.removeItem(COACH_RETURN_KEY);
  } catch {
    // no sessionStorage: the browser's own Back still works
  }
}

export function coachReturnPath(): string | null {
  try {
    const p = sessionStorage.getItem(COACH_RETURN_KEY);
    return p && p.startsWith('/study') ? p : null;
  } catch {
    return null;
  }
}

/** Test hook. */
export function _resetStudyResume(): void {
  memoryPoint = null;
  extras = null;
  undo = null;
}
