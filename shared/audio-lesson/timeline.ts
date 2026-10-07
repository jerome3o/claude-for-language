/**
 * Where things are in a rendered lesson: chapter starts and transcript lines in
 * ms, from the script and each clip's length. The worker's MP3 assembly works
 * in whole frames (24 ms at 24 kHz), so lengths here are frame-quantised the
 * same way and the player's chapter list lines up with the audio exactly.
 * Also the player's small pure helpers (which chapter is playing, clock text,
 * sleep-timer choices).
 */
import { speechKey } from './validate';
import type { AudioLessonChapter, AudioLessonScript, AudioLessonTranscriptLine } from './types';

export interface LessonTimeline {
  chapters: AudioLessonChapter[];
  transcript: AudioLessonTranscriptLine[];
  duration_ms: number;
}

/**
 * @param clipFrames frames per clip, by `speechKey`
 * @param frameMs ms per frame (24 for the lesson MP3 format)
 * @param leadFrames frames before the first segment (the Xing header frame)
 */
export function buildTimeline(script: AudioLessonScript, clipFrames: Map<string, number>, frameMs: number, leadFrames = 0): LessonTimeline {
  let frames = leadFrames;
  const chapterStart = new Map<number, number>();
  const transcript: AudioLessonTranscriptLine[] = [];
  for (const s of script.segments) {
    if (!chapterStart.has(s.chapter)) chapterStart.set(s.chapter, frames);
    if (s.kind === 'pause') {
      frames += Math.max(0, Math.round(s.ms / frameMs));
      continue;
    }
    const n = clipFrames.get(speechKey(s));
    if (n === undefined) throw new Error(`no clip for "${s.text.slice(0, 30)}"`);
    const line: AudioLessonTranscriptLine = { start_ms: Math.round(frames * frameMs), lang: s.lang, voice: s.voice, text: s.text, chapter: s.chapter };
    if (s.pinyin) line.pinyin = s.pinyin;
    if (s.english) line.english = s.english;
    transcript.push(line);
    frames += n;
  }
  const chapters = script.chapters.map((c, i) => ({ title: c.title, start_ms: Math.round((chapterStart.get(i) ?? frames) * frameMs) }));
  return { chapters, transcript, duration_ms: Math.round(frames * frameMs) };
}

/** Index of the chapter playing at `ms` (the last one that started). */
export function chapterIndexAt(chapters: AudioLessonChapter[], ms: number): number {
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start_ms <= ms + 1) idx = i;
  return idx;
}

/** Index of the transcript line playing at `ms`, -1 before the first. */
export function transcriptIndexAt(lines: AudioLessonTranscriptLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start_ms <= ms + 1) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Where "previous chapter" goes: this chapter's start, or the one before when within 3 s of the start. */
export function previousChapterTarget(chapters: AudioLessonChapter[], ms: number): number {
  const i = chapterIndexAt(chapters, ms);
  if (i > 0 && ms - chapters[i].start_ms < 3000) return chapters[i - 1].start_ms;
  return chapters[i]?.start_ms ?? 0;
}

/** "1:05", "12:40", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "about 14 min". */
export function durationLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  return `${min} min`;
}

/** Sleep-timer choices in minutes; 0 = off, -1 = end of this chapter. */
export const SLEEP_TIMER_CHOICES: readonly number[] = [0, 10, 15, 20, 30, 45, 60, -1];

export function sleepTimerLabel(minutes: number): string {
  if (minutes === 0) return 'Off';
  if (minutes === -1) return 'End of chapter';
  return `${minutes} min`;
}

/** The last stretch of a sleep timer fades the volume out over this long. */
export const SLEEP_FADE_MS = 30_000;

/** Volume multiplier `remainingMs` before the timer ends (1 → 0 over the fade). */
export function sleepFadeVolume(remainingMs: number): number {
  if (remainingMs >= SLEEP_FADE_MS) return 1;
  if (remainingMs <= 0) return 0;
  return remainingMs / SLEEP_FADE_MS;
}

/** Playback speeds offered by the players (pitch kept). */
export const AUDIO_LESSON_SPEEDS: readonly number[] = [0.75, 0.9, 1, 1.25];

export interface TranscriptRow {
  /** Index of the first transcript line in this row. */
  first: number;
  /** Index of the last. */
  last: number;
  start_ms: number;
  lang: AudioLessonTranscriptLine['lang'];
  text: string;
  pinyin?: string;
  english?: string;
}

/**
 * The transcript as the player shows it: an English sentence with Chinese inside
 * ("a 兰州拉面 place") is spoken as several clips, shown as ONE row.
 */
export function transcriptRows(lines: AudioLessonTranscriptLine[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const isNarration = (l: AudioLessonTranscriptLine) => l.voice === 'narrator' || (l.voice === 'teacher' && !l.pinyin);
  lines.forEach((l, i) => {
    const prev = rows[rows.length - 1];
    const prevLine = lines[i - 1];
    // The host reading the translation of the line just shown under it ("Line by line"): one row.
    if (prev && l.voice === 'narrator' && prev.english && prev.english.trim() === l.text.trim()) {
      prev.last = i;
      return;
    }
    const open = prev && prevLine && isNarration(prevLine) && isNarration(l) && prevLine.chapter === l.chapter && !/[.!?:]["”’)]?$/.test(prevLine.text.trim());
    if (open) {
      const glue = l.lang === 'zh' || prevLine.lang === 'zh' ? (/^[,.;:!?]/.test(l.text) ? '' : ' ') : ' ';
      prev.text = `${prev.text}${glue}${l.text}`;
      prev.last = i;
      prev.lang = 'en';
      return;
    }
    const row: TranscriptRow = { first: i, last: i, start_ms: l.start_ms, lang: l.lang, text: l.text };
    if (l.pinyin) row.pinyin = l.pinyin;
    if (l.english) row.english = l.english;
    rows.push(row);
  });
  return rows;
}
