/**
 * Per-exercise attempt data: what the learner answered in each exercise of a
 * lesson run and how long they spent on it, so a tutor can review the work
 * (typed text, chosen options, handwriting, recordings) and not just a score.
 *
 * Offline-first: the study screen builds a LessonAttemptData while the
 * learner works; it rides on the lesson's completion event (same id) and is
 * uploaded with it, idempotently. Recordings are blobs, uploaded separately
 * by media key (see exerciseMediaKey) once the attempt is on the server.
 */

import type { LessonSentence } from './types';

/** Handwriting as vector strokes — small, and re-drawable at any size. */
export interface HandwritingStrokes {
  /** Pad size the points are measured in. */
  width: number;
  height: number;
  /** One flat [x0, y0, x1, y1, …] list per stroke, integers. */
  strokes: number[][];
}

export interface HandwritingAnswer {
  strokes?: HandwritingStrokes;
  /** What the pad recognised / checked, when it can. */
  text?: string;
  /** The pad's own verdict (a stroke checker); absent when self-assessed. */
  checked?: boolean;
  /** Stroke mistakes reported by a stroke checker. */
  mistakes?: number;
  /** Which pad produced it: 'sketch' (free drawing) or a stroke engine's id. */
  engine?: string;
}

/** Claude's feedback on a sentence the learner made. */
export interface SentenceFeedback {
  verdict: 'correct' | 'minor' | 'incorrect';
  /** Did the sentence use every target word? */
  uses_all_words: boolean;
  /** The corrected sentence (absent when already correct). */
  corrected?: LessonSentence;
  /** 1-3 sentences in English. */
  comment: string;
}

export interface ExerciseAnswer {
  /** Typed text (translate, writing, dictation, sentence making, listen & translate). */
  text?: string;
  /** The option chosen — an index into the SPEC's options (not display order). */
  choice?: number;
  /** Scramble tiles in the order the learner put them. */
  order?: string[];
  /** Wrong taps (match). */
  mistakes?: number;
  /** The verdict came from the learner's own Got it / Missed it. */
  self_assessed?: boolean;
  /** Revealed a hint (the English on a scramble, the transcript early…). */
  hint_used?: boolean;
  /** Times the audio was played (listening exercises). */
  plays?: number;
  handwriting?: HandwritingAnswer;
  /** A recording made in this exercise, uploaded under this media key. */
  recording?: { media_key: string; duration_ms: number; mime?: string };
  feedback?: SentenceFeedback;
  /** Conversation: one entry per question. */
  questions?: Array<{ choice?: number; text?: string; correct: boolean | null }>;
}

export interface ExerciseAttempt {
  /** Position in the spec. */
  section: number;
  index: number;
  type: string;
  /** null for unscored exercises (notes). */
  correct: boolean | null;
  points: number;
  max_points: number;
  /** Time on this exercise, first render to Continue. */
  duration_ms: number;
  answer?: ExerciseAnswer;
}

export interface LessonAttemptData {
  started_at: string;
  /** Start of the lesson to the rating tap. */
  duration_ms: number;
  exercises: ExerciseAttempt[];
}

/** Media key for an exercise's recording: stable per position in a run. */
export function exerciseMediaKey(section: number, index: number): string {
  return `s${section}e${index}`;
}

export interface SectionTime {
  section: number;
  duration_ms: number;
  exercises: number;
  correct: number;
  scored: number;
}

/** Time and score per section, from the per-exercise attempts. */
export function sectionTimes(data: LessonAttemptData): SectionTime[] {
  const bySection = new Map<number, SectionTime>();
  for (const ex of data.exercises) {
    const s = bySection.get(ex.section) ?? { section: ex.section, duration_ms: 0, exercises: 0, correct: 0, scored: 0 };
    s.duration_ms += Math.max(0, ex.duration_ms);
    s.exercises++;
    if (ex.correct !== null) {
      s.scored++;
      if (ex.correct) s.correct++;
    }
    bySection.set(ex.section, s);
  }
  return [...bySection.values()].sort((a, b) => a.section - b.section);
}

/** "1:05", "12 s" */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ============ Server-side shape check ============

const MAX_EXERCISES = 60;
const MAX_TEXT = 2000;
const MAX_STROKE_NUMBERS = 12000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = MAX_TEXT): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function int(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;
}

function cleanStrokes(v: unknown): HandwritingStrokes | undefined {
  if (!isRecord(v) || !Array.isArray(v.strokes)) return undefined;
  const width = int(v.width, 1, 4000);
  const height = int(v.height, 1, 4000);
  if (!width || !height) return undefined;
  const strokes: number[][] = [];
  let total = 0;
  for (const s of v.strokes) {
    if (!Array.isArray(s)) continue;
    const nums = s.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).map(n => Math.round(n));
    total += nums.length;
    if (total > MAX_STROKE_NUMBERS) break;
    strokes.push(nums.length % 2 === 0 ? nums : nums.slice(0, -1));
  }
  return { width, height, strokes };
}

function cleanAnswer(v: unknown): ExerciseAnswer | undefined {
  if (!isRecord(v)) return undefined;
  const out: ExerciseAnswer = {};
  const text = str(v.text);
  if (text !== undefined) out.text = text;
  const choice = int(v.choice, 0, 20);
  if (choice !== undefined) out.choice = choice;
  if (Array.isArray(v.order)) out.order = v.order.filter((t): t is string => typeof t === 'string').slice(0, 30).map(t => t.slice(0, 50));
  const mistakes = int(v.mistakes, 0, 1000);
  if (mistakes !== undefined) out.mistakes = mistakes;
  if (typeof v.self_assessed === 'boolean') out.self_assessed = v.self_assessed;
  if (typeof v.hint_used === 'boolean') out.hint_used = v.hint_used;
  const plays = int(v.plays, 0, 1000);
  if (plays !== undefined) out.plays = plays;
  if (isRecord(v.handwriting)) {
    const h = v.handwriting;
    out.handwriting = {
      strokes: cleanStrokes(h.strokes),
      text: str(h.text, 200),
      checked: typeof h.checked === 'boolean' ? h.checked : undefined,
      mistakes: int(h.mistakes, 0, 1000),
      engine: str(h.engine, 40),
    };
  }
  if (isRecord(v.recording) && typeof v.recording.media_key === 'string' && /^[a-z0-9]{1,20}$/i.test(v.recording.media_key)) {
    out.recording = {
      media_key: v.recording.media_key,
      duration_ms: int(v.recording.duration_ms, 0, MAX_DURATION_MS) ?? 0,
      mime: str(v.recording.mime, 60),
    };
  }
  if (isRecord(v.feedback)) {
    const f = v.feedback;
    const verdict = f.verdict === 'correct' || f.verdict === 'minor' || f.verdict === 'incorrect' ? f.verdict : null;
    if (verdict) {
      out.feedback = {
        verdict,
        uses_all_words: f.uses_all_words === true,
        comment: str(f.comment, 1000) ?? '',
        corrected: isRecord(f.corrected) && typeof f.corrected.hanzi === 'string'
          ? { hanzi: f.corrected.hanzi.slice(0, 300), pinyin: str(f.corrected.pinyin, 500), english: str(f.corrected.english, 500) }
          : undefined,
      };
    }
  }
  if (Array.isArray(v.questions)) {
    out.questions = v.questions.slice(0, 10).map(q => {
      const r = isRecord(q) ? q : {};
      return {
        choice: int(r.choice, 0, 20),
        text: str(r.text, 1000),
        correct: typeof r.correct === 'boolean' ? r.correct : null,
      };
    });
  }
  return out;
}

/**
 * The attempt data from an upload, reduced to the known shape with size
 * caps (never trust a client blob into the database verbatim). Null when
 * it isn't attempt data at all.
 */
export function sanitizeAttemptData(input: unknown): LessonAttemptData | null {
  if (!isRecord(input) || !Array.isArray(input.exercises)) return null;
  const exercises: ExerciseAttempt[] = [];
  for (const raw of input.exercises.slice(0, MAX_EXERCISES)) {
    if (!isRecord(raw)) continue;
    const section = int(raw.section, 0, 100);
    const index = int(raw.index, 0, 100);
    const type = str(raw.type, 40);
    if (section === undefined || index === undefined || !type) continue;
    const maxPoints = int(raw.max_points, 0, 20) ?? 0;
    exercises.push({
      section,
      index,
      type,
      correct: typeof raw.correct === 'boolean' ? raw.correct : null,
      points: Math.min(int(raw.points, 0, 20) ?? 0, maxPoints),
      max_points: maxPoints,
      duration_ms: int(raw.duration_ms, 0, MAX_DURATION_MS) ?? 0,
      answer: cleanAnswer(raw.answer),
    });
  }
  return {
    started_at: str(input.started_at, 40) ?? '',
    duration_ms: int(input.duration_ms, 0, MAX_DURATION_MS) ?? 0,
    exercises,
  };
}
