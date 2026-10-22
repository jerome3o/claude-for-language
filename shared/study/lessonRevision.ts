/**
 * Mini lessons come back as REVISIONS until everything is right first time
 * (docs/STUDY_SESSION.md "Mini lessons: revise until right first time").
 *
 * Jerome (Oct 2026): "Get rid of 'when do you want to see it next'. It always comes back unless
 * you got 100% first time: 100% first time → done forever. Otherwise it comes back 1 week later
 * as a revision: all the questions you didn't get first time last time, plus a very small subset
 * of the ones you did get. Keep doing the weekly revision cycle until you get all the questions
 * right first time."
 *
 * - A finished run's OUTCOME (`runOutcome`, from its attempt's main-pass rows): the scored
 *   exercises it asked and the ones missed first time. The retry round never changes it.
 * - The LATEST run decides: nothing missed → done forever; else a revision, due
 *   LESSON_REVISION_GAP_DAYS after it (`isRevisionDue` against the study cutoff = that local day).
 * - A revision (`revisionKeys`) = every exercise missed last time + a few the learner got
 *   (REVISION_EXTRA_SHARE of them, 1–3, picked deterministically from a seed and spread across
 *   exercise types). It is a run like any other: same retry round, same rule.
 * - Before Oct 2026 (no outcome): a finish with an attempt has one (the server derives it); a
 *   finish without one (Sep 2026) follows its rating — Again / Hard → a revision of the whole
 *   lesson, otherwise done. "Done for good" (revisit_events retire) = done forever; "Bring back"
 *   undoes it.
 *
 * Event-sourced: replayed from the completion events (+ the old retire / restore marks), never
 * stored. Pure; the Lab app's port (core/…/LessonRevision.kt) is parity-tested against it.
 */
import { exerciseKey, type LessonRunStep } from './lessonRun';

/** Days from a finished run to its revision (Jerome first said two weeks, then settled on one). */
export const LESSON_REVISION_GAP_DAYS = 7;
/** Of the exercises got right, about this share comes back in a revision… */
export const REVISION_EXTRA_SHARE = 0.2;
/** …at least this many (when there are any)… */
export const REVISION_EXTRA_MIN = 1;
/** …and at most this many. */
export const REVISION_EXTRA_MAX = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one finished run tells: the scored exercises it asked, and those missed first time. */
export interface LessonRunOutcome {
  keys: string[];
  missed: string[];
}

interface AttemptRowLike {
  section: number;
  index: number;
  correct: boolean | null;
  points?: number;
  max_points?: number;
  retry?: number;
}

/** A run's outcome from its attempt rows: main-pass, scored rows only (a conversation with a missed question is missed). */
export function runOutcome(attempt: { exercises: ReadonlyArray<AttemptRowLike> } | null | undefined): LessonRunOutcome | null {
  if (!attempt || !Array.isArray(attempt.exercises)) return null;
  const keys: string[] = [];
  const missed: string[] = [];
  for (const row of attempt.exercises) {
    if ((row.retry ?? 0) > 0) continue;
    if (row.correct === null || row.correct === undefined) continue;
    if ((row.max_points ?? 1) <= 0) continue;
    const key = exerciseKey(row.section, row.index);
    if (keys.includes(key)) continue;
    keys.push(key);
    const wrong = row.correct === false || (typeof row.points === 'number' && typeof row.max_points === 'number' && row.points < row.max_points);
    if (wrong) missed.push(key);
  }
  return { keys, missed };
}

const KEY_RE = /^s\d{1,3}e\d{1,3}$/;

/** A stored / uploaded outcome back (JSON string or object); null when it isn't one. */
export function parseRunOutcome(raw: unknown): LessonRunOutcome | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.keys) || !Array.isArray(o.missed)) return null;
  const keys = o.keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)).slice(0, 200);
  const set = new Set(keys);
  const missed = o.missed.filter((k): k is string => typeof k === 'string' && set.has(k));
  return { keys: [...new Set(keys)], missed: [...new Set(missed)] };
}

/** One finished run as the rule sees it. `outcome` null = a legacy finish (its `rating` decides). */
export interface LessonRunRecord {
  id: string;
  at: string;
  outcome: LessonRunOutcome | null;
  rating: number | null;
}

/** "Done for good" / "Bring back" from before Oct 2026 (revisit_events). */
export interface LessonMarkRecord {
  id: string;
  at: string;
  action: 'retire' | 'restore';
}

export type LessonLearnStatus = 'new' | 'revision' | 'done';

export interface LessonLearnState {
  status: LessonLearnStatus;
  /** Revision: when it is due (ms); null otherwise. */
  due_ms: number | null;
  /** Revision: its number (1 = the first revision after a run with mistakes); 0 otherwise. */
  revision: number;
  /** Revision: the exercises missed first time last run (the ones to get right). */
  missed: string[];
  /** Revision: the whole lesson (a legacy Again / Hard finish with no answers kept). */
  full: boolean;
  /** Finished runs. */
  runs: number;
  /** The latest finished run (ms), null before the first. */
  last_ms: number | null;
  /** Its id: the seed of the revision's pick, so every device picks the same. */
  last_run_id: string | null;
}

export const NEW_LESSON_STATE: Readonly<LessonLearnState> = Object.freeze({
  status: 'new', due_ms: null, revision: 0, missed: [], full: false, runs: 0, last_ms: null, last_run_id: null,
});

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function byTime<T extends { id: string; at: string }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Whether one run left something to get right (legacy: rated Again / Hard). */
function runImperfect(run: LessonRunRecord): { imperfect: boolean; missed: string[]; full: boolean } {
  if (run.outcome) return { imperfect: run.outcome.missed.length > 0, missed: [...run.outcome.missed], full: false };
  const imperfect = run.rating === 0 || run.rating === 1;
  return { imperfect, missed: [], full: imperfect };
}

/** Replay a lesson's history: the latest run decides; a later Done for good (until a Bring back) makes it done. */
export function computeLessonLearnState(runs: readonly LessonRunRecord[], marks: readonly LessonMarkRecord[] = []): LessonLearnState {
  type Ev = { id: string; at: string; run?: LessonRunRecord; mark?: LessonMarkRecord };
  const events: Ev[] = [
    ...runs.map(r => ({ id: r.id, at: r.at, run: r })),
    ...marks.map(m => ({ id: m.id, at: m.at, mark: m })),
  ];
  let retired = false;
  let count = 0;
  let streak = 0;
  let last: LessonRunRecord | null = null;
  let lastResult = { imperfect: false, missed: [] as string[], full: false };
  for (const e of byTime(events)) {
    if (e.run) {
      count++;
      last = e.run;
      lastResult = runImperfect(e.run);
      streak = lastResult.imperfect ? streak + 1 : 0;
      retired = false;
    } else if (e.mark) {
      retired = e.mark.action === 'retire';
    }
  }
  const lastMs = last ? ms(last.at) : null;
  const base = { runs: count, last_ms: lastMs, last_run_id: last?.id ?? null };
  if (retired) return { ...base, status: 'done', due_ms: null, revision: 0, missed: [], full: false };
  if (!last) return { ...NEW_LESSON_STATE, missed: [] };
  if (!lastResult.imperfect) return { ...base, status: 'done', due_ms: null, revision: 0, missed: [], full: false };
  return {
    ...base,
    status: 'revision',
    due_ms: (lastMs ?? 0) + LESSON_REVISION_GAP_DAYS * DAY_MS,
    revision: streak,
    missed: lastResult.missed,
    full: lastResult.full,
  };
}

/** A revision due by the study cutoff (the end of today). */
export function isRevisionDue(state: LessonLearnState, cutoffMs: number): boolean {
  return state.status === 'revision' && state.due_ms !== null && state.due_ms <= cutoffMs;
}

/** Days until a revision is due: 0 = due (today or earlier), 1 = tomorrow… */
export function revisionDaysAway(state: LessonLearnState, cutoffMs: number): number {
  if (state.status !== 'revision' || state.due_ms === null || state.due_ms <= cutoffMs) return 0;
  return Math.ceil((state.due_ms - cutoffMs) / DAY_MS);
}

/** 32-bit FNV-1a over UTF-16 code units (the Kotlin port hashes String chars the same way). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** How many of `candidates` exercises got right join a revision. */
export function revisionExtraCount(candidates: number): number {
  if (candidates <= 0) return 0;
  const n = Math.floor(candidates * REVISION_EXTRA_SHARE + 0.5);
  return Math.min(candidates, Math.max(REVISION_EXTRA_MIN, Math.min(REVISION_EXTRA_MAX, n)));
}

/**
 * The scored exercises of the next revision, in lesson order: every one missed last time that
 * still exists, plus `revisionExtraCount` of the others — ranked by a hash of
 * `<lessonId>:<last run id>|<key>`, taken round-robin across exercise types (types ordered by
 * their best-ranked exercise), so they spread over the kinds of question. A whole-lesson
 * revision (legacy), or one whose missed exercises were all edited away, is every scored one.
 */
export function revisionKeys(state: LessonLearnState, steps: readonly Pick<LessonRunStep, 'key' | 'type' | 'scored'>[], lessonId: string): string[] {
  const scored = steps.filter(s => s.scored);
  const missedSet = new Set(state.missed);
  const missed = scored.filter(s => missedSet.has(s.key));
  if (state.full || missed.length === 0) return scored.map(s => s.key);
  const candidates = scored.filter(s => !missedSet.has(s.key));
  const want = revisionExtraCount(candidates.length);
  const seed = `${lessonId}:${state.last_run_id ?? ''}`;
  const ranked = candidates
    .map(s => ({ s, h: fnv1a32(`${seed}|${s.key}`) }))
    .sort((a, b) => a.h - b.h || (a.s.key < b.s.key ? -1 : a.s.key > b.s.key ? 1 : 0));
  const types: string[] = [];
  const byType = new Map<string, typeof ranked>();
  for (const r of ranked) {
    const list = byType.get(r.s.type);
    if (list) list.push(r);
    else { byType.set(r.s.type, [r]); types.push(r.s.type); }
  }
  const picked = new Set<string>();
  for (let round = 0; picked.size < want; round++) {
    let any = false;
    for (const t of types) {
      const list = byType.get(t)!;
      if (round < list.length && picked.size < want) { picked.add(list[round].s.key); any = true; }
    }
    if (!any) break;
  }
  return scored.filter(s => missedSet.has(s.key) || picked.has(s.key)).map(s => s.key);
}

/** "Revision 2" */
export function revisionTitle(state: Pick<LessonLearnState, 'revision'>): string {
  return state.revision > 0 ? `Revision ${state.revision}` : 'Revision';
}

/** "3 to get right" — the missed ones of a revision (the whole lesson: its scored count). */
export function toGetRightLabel(state: LessonLearnState, scoredCount: number): string {
  const n = state.full || state.missed.length === 0 ? scoredCount : state.missed.length;
  return `${n} to get right`;
}

/** "due today" / "due tomorrow" / "in 5 days" for a revision. */
export function revisionDueText(state: LessonLearnState, cutoffMs: number): string {
  const d = revisionDaysAway(state, cutoffMs);
  return d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `in ${d} days`;
}

/**
 * The end of a run, in words — what the player says once the retry round is over:
 * "All right first time — done for good! 🎉" or "Back in a week as a revision (4 questions)".
 */
export function runEndLine(outcome: LessonRunOutcome, revision: boolean): string {
  if (outcome.missed.length === 0) {
    return revision ? 'All right first time — this lesson is done for good! 🎉' : 'All right first time — done for good! 🎉';
  }
  const n = outcome.missed.length;
  return `Back in a week as a revision: the ${n} you missed first time + a few you got`;
}
