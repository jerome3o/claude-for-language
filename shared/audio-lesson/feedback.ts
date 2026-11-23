/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"): from the lock screen,
 * the media notification, headphones or the player, the learner can go back a section or say "Too hard"
 * without looking. Every press is a small event Claude reads later (MCP `get_audio_lesson_feedback`)
 * to see which lines were hard.
 *
 * A SECTION is a transcript row as the player shows it (`transcriptRows`): a sentence with its repeats
 * ("×3 +2"), a sleep word with its repeats, an English narration with the Chinese inside it — the unit
 * "say that again" means. Back a section = the start of the row playing; when that row started less than
 * 2 s of listening ago, the row before (you pressed because of what you just heard). The same 2 s decide
 * which row a "Too hard" is about (reaction lag).
 *
 * Pure; the Lab app's port is core/…/AudioLessonFeedback.kt (parity-tested by
 * android-lab/parity/fixtures/audio-lesson-feedback.ts).
 */
import { chapterIndexAt, type TranscriptRow } from './timeline';
import type { AudioLessonChapter } from './types';

export const AUDIO_LESSON_FEEDBACK_KINDS = ['too_hard', 'back_section', 'again', 'skip'] as const;
/**
 * too_hard = "Too hard"; again = back a section that restarted the row playing; back_section = back a section
 * that went to the row before (pressed within 2 s of a row's start); skip = next section.
 */
export type AudioLessonFeedbackKind = (typeof AUDIO_LESSON_FEEDBACK_KINDS)[number];

export const AUDIO_LESSON_FEEDBACK_SOURCES = ['lock_screen', 'notification', 'player', 'headset'] as const;
/** Where the press came from (the system media controls on the lock screen / in the shade, a headset button, the app's player). */
export type AudioLessonFeedbackWhere = (typeof AUDIO_LESSON_FEEDBACK_SOURCES)[number];

/** Within this much LISTENING of a row's start, "back" goes to the row before and "Too hard" is about it. */
export const BACK_SECTION_GRACE_MS = 2000;

/** At most this many events in one upload. */
export const MAX_FEEDBACK_EVENTS_PER_REQUEST = 100;

/** A snapshot's text is cut to this many characters (a narration row can be long). */
export const FEEDBACK_ROW_TEXT_MAX = 300;

/** The grace in MEDIA time at a playback speed: 2 s of listening at 0.75× is 1.5 s of audio. */
export function sectionGraceMs(speed = 1): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.round(BACK_SECTION_GRACE_MS * s);
}

/** Index of the row playing at `ms` (the last one that started; -1 before the first). */
export function rowIndexAt(rows: ReadonlyArray<Pick<TranscriptRow, 'start_ms'>>, ms: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].start_ms <= ms + 1) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface SectionJump {
  target_ms: number;
  /** The row the jump lands on (-1 = the very start, before any row). */
  row_index: number;
  kind: AudioLessonFeedbackKind;
}

/**
 * "Back a section": the start of the row playing (`again`), or the row before when this one started
 * less than 2 s of listening ago (`back_section`). Before the first row: the start. null when the
 * lesson has no transcript (the caller falls back to chapters).
 */
export function backSectionTarget(rows: ReadonlyArray<Pick<TranscriptRow, 'start_ms'>>, ms: number, speed = 1): SectionJump | null {
  if (rows.length === 0) return null;
  const i = rowIndexAt(rows, ms);
  if (i < 0) return { target_ms: 0, row_index: -1, kind: 'again' };
  if (i > 0 && ms - rows[i].start_ms < sectionGraceMs(speed)) return { target_ms: rows[i - 1].start_ms, row_index: i - 1, kind: 'back_section' };
  return { target_ms: rows[i].start_ms, row_index: i, kind: 'again' };
}

/** "Next section": the start of the row after the one playing; null on the last row / no transcript. */
export function nextSectionTarget(rows: ReadonlyArray<Pick<TranscriptRow, 'start_ms'>>, ms: number): SectionJump | null {
  const next = rowIndexAt(rows, ms) + 1;
  if (next >= rows.length) return null;
  return { target_ms: rows[next].start_ms, row_index: next, kind: 'skip' };
}

/** What a feedback event keeps of a row: enough for Claude to know the line without the lesson. */
export interface FeedbackRowSnapshot {
  index: number;
  start_ms: number;
  text: string;
  pinyin?: string;
  english?: string;
}

function cut(s: string): string {
  return s.length > FEEDBACK_ROW_TEXT_MAX ? s.slice(0, FEEDBACK_ROW_TEXT_MAX - 1) + '…' : s;
}

export function rowSnapshot(rows: ReadonlyArray<TranscriptRow>, i: number): FeedbackRowSnapshot | null {
  const r = rows[i];
  if (!r) return null;
  const snap: FeedbackRowSnapshot = { index: i, start_ms: r.start_ms, text: cut(r.text) };
  if (r.pinyin) snap.pinyin = cut(r.pinyin);
  if (r.english) snap.english = cut(r.english);
  return snap;
}

export interface AudioLessonFeedbackEvent {
  /** Client id (idempotent upload). */
  id: string;
  audio_lesson_id: string;
  kind: AudioLessonFeedbackKind;
  where: AudioLessonFeedbackWhere;
  /** Where the audio was when pressed (before any jump). */
  position_ms: number;
  chapter_index: number;
  /** The row playing when pressed (-1 before the first). */
  row_index: number;
  row: FeedbackRowSnapshot | null;
  /** The row before it: with reaction lag, often the one meant. */
  previous_row: FeedbackRowSnapshot | null;
  speed: number;
  /** The lesson's file version (a rebuilt lesson can have other rows). */
  audio_version: string | null;
  created_at: string;
}

/** One press → its event (the player calls this with its own rows, chapters, speed). */
export function buildFeedbackEvent(input: {
  id: string;
  lessonId: string;
  kind: AudioLessonFeedbackKind;
  where: AudioLessonFeedbackWhere;
  positionMs: number;
  speed: number;
  audioVersion: string | null;
  createdAt: string;
  rows: ReadonlyArray<TranscriptRow>;
  chapters: ReadonlyArray<AudioLessonChapter>;
}): AudioLessonFeedbackEvent {
  const pos = Math.max(0, Math.round(input.positionMs));
  const i = rowIndexAt(input.rows, pos);
  return {
    id: input.id,
    audio_lesson_id: input.lessonId,
    kind: input.kind,
    where: input.where,
    position_ms: pos,
    chapter_index: input.chapters.length ? chapterIndexAt(input.chapters as AudioLessonChapter[], pos) : 0,
    row_index: i,
    row: rowSnapshot(input.rows, i),
    previous_row: rowSnapshot(input.rows, i - 1),
    speed: Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1,
    audio_version: input.audioVersion,
    created_at: input.createdAt,
  };
}

/**
 * The row an event is about: `again` / `skip` → the row playing; `back_section` → the row before it;
 * `too_hard` → the row before when pressed within 2 s of listening into this one, else this one.
 * null when there is no such row.
 */
export function flaggedRowIndex(e: Pick<AudioLessonFeedbackEvent, 'kind' | 'position_ms' | 'row_index' | 'speed'> & {
  row: Pick<FeedbackRowSnapshot, 'start_ms'> | null;
  previous_row: Pick<FeedbackRowSnapshot, 'index'> | null;
}): number | null {
  if (e.kind === 'back_section') return e.previous_row ? e.previous_row.index : e.row ? e.row_index : null;
  if (e.kind === 'too_hard' && e.row && e.previous_row && e.position_ms - e.row.start_ms < sectionGraceMs(e.speed)) return e.previous_row.index;
  return e.row && e.row_index >= 0 ? e.row_index : null;
}

// ---- Server side: checking an upload, summing a lesson's events for Claude ----

function snapshotFrom(raw: unknown): FeedbackRowSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || !Number.isInteger(r.index) || (r.index as number) < 0) return null;
  const snap: FeedbackRowSnapshot = { index: r.index as number, start_ms: Number.isFinite(r.start_ms) ? Math.max(0, Math.round(r.start_ms as number)) : 0, text: cut(r.text) };
  if (typeof r.pinyin === 'string' && r.pinyin) snap.pinyin = cut(r.pinyin);
  if (typeof r.english === 'string' && r.english) snap.english = cut(r.english);
  return snap;
}

/** An uploaded event checked and normalised; null when it can't be one (the route refuses it). */
export function pickFeedbackEvent(raw: unknown, lessonId: string): AudioLessonFeedbackEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(r.id)) return null;
  if (r.audio_lesson_id !== undefined && r.audio_lesson_id !== lessonId) return null;
  if (!AUDIO_LESSON_FEEDBACK_KINDS.includes(r.kind as AudioLessonFeedbackKind)) return null;
  const where = AUDIO_LESSON_FEEDBACK_SOURCES.includes(r.where as AudioLessonFeedbackWhere) ? (r.where as AudioLessonFeedbackWhere) : 'player';
  if (typeof r.position_ms !== 'number' || !Number.isFinite(r.position_ms) || r.position_ms < 0 || r.position_ms > 24 * 3600_000) return null;
  const created = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
  if (!Number.isFinite(created)) return null;
  const speed = typeof r.speed === 'number' && Number.isFinite(r.speed) && r.speed > 0 && r.speed <= 4 ? r.speed : 1;
  return {
    id: r.id,
    audio_lesson_id: lessonId,
    kind: r.kind as AudioLessonFeedbackKind,
    where,
    position_ms: Math.round(r.position_ms),
    chapter_index: Number.isInteger(r.chapter_index) && (r.chapter_index as number) >= 0 ? (r.chapter_index as number) : 0,
    row_index: Number.isInteger(r.row_index) && (r.row_index as number) >= -1 ? (r.row_index as number) : -1,
    row: snapshotFrom(r.row),
    previous_row: snapshotFrom(r.previous_row),
    speed,
    audio_version: typeof r.audio_version === 'string' && r.audio_version ? r.audio_version.slice(0, 80) : null,
    created_at: new Date(created).toISOString(),
  };
}

export interface FeedbackRowSummary extends FeedbackRowSnapshot {
  too_hard: number;
  /** Back a section that replayed this row (`again`, or `back_section` to it). */
  replays: number;
  skips: number;
}

export interface LessonFeedbackSummary {
  counts: Record<AudioLessonFeedbackKind, number>;
  /** The rows the events are about, the hardest first (too hard ×2 + replays, then the earliest). */
  rows: FeedbackRowSummary[];
  /** The furthest point any press was made at (a lower bound on how far he listened). */
  furthest_ms: number;
  first_at: string | null;
  last_at: string | null;
  /** One line: "Too hard ×3 · went back ×5 · skipped ×1 — hardest: 你怎么去公司？ (too hard ×2, replayed ×2)". */
  line: string;
}

export function summarizeLessonFeedback(events: ReadonlyArray<AudioLessonFeedbackEvent>): LessonFeedbackSummary {
  const counts: Record<AudioLessonFeedbackKind, number> = { too_hard: 0, back_section: 0, again: 0, skip: 0 };
  const rows = new Map<number, FeedbackRowSummary>();
  let furthest = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const e of events) {
    counts[e.kind]++;
    furthest = Math.max(furthest, e.position_ms);
    if (!first || e.created_at < first) first = e.created_at;
    if (!last || e.created_at > last) last = e.created_at;
    const idx = flaggedRowIndex(e);
    if (idx === null) continue;
    const snap = idx === e.row_index ? e.row : idx === e.previous_row?.index ? e.previous_row : null;
    if (!snap) continue;
    const row = rows.get(idx) ?? { ...snap, too_hard: 0, replays: 0, skips: 0 };
    if (e.kind === 'too_hard') row.too_hard++;
    else if (e.kind === 'skip') row.skips++;
    else row.replays++;
    rows.set(idx, row);
  }
  const ranked = [...rows.values()].sort((a, b) => (b.too_hard * 2 + b.replays) - (a.too_hard * 2 + a.replays) || a.index - b.index);
  const parts: string[] = [];
  if (counts.too_hard) parts.push(`Too hard ×${counts.too_hard}`);
  const back = counts.again + counts.back_section;
  if (back) parts.push(`went back ×${back}`);
  if (counts.skip) parts.push(`skipped ×${counts.skip}`);
  const top = ranked.find((r) => r.too_hard + r.replays > 0);
  let line = parts.length ? parts.join(' · ') : 'No feedback';
  if (top) {
    const why = [top.too_hard ? `too hard ×${top.too_hard}` : '', top.replays ? `replayed ×${top.replays}` : ''].filter(Boolean).join(', ');
    line += ` — hardest: ${top.text.length > 60 ? top.text.slice(0, 59) + '…' : top.text} (${why})`;
  }
  return { counts, rows: ranked, furthest_ms: furthest, first_at: first, last_at: last, line };
}
