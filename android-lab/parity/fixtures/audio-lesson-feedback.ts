/**
 * Feedback while listening (shared/audio-lesson/feedback.ts): back / next a section, the 2 s grace at
 * every speed, the events' row snapshots and which row an event is about — over the sample dialogue,
 * sleep and story lessons compiled and timed like the worker does (seeded clip lengths, 24 ms frames,
 * one lead frame). Writes audio-lesson-feedback.json; core AudioLessonFeedbackParityTest asserts
 * AudioLessonFeedback.kt matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SAMPLE_DIALOGUE_PLAN,
  SAMPLE_SLEEP_PLAN,
  SAMPLE_SLEEP_SOURCE,
  SAMPLE_STORY_PLAN,
  buildTimeline,
  compileDialogueLesson,
  compileSleepLesson,
  compileStoryLesson,
  speechKey,
  transcriptRows,
  type AudioLessonScript,
} from '../../../shared/audio-lesson';
import {
  AUDIO_LESSON_FEEDBACK_KINDS,
  BACK_SECTION_GRACE_MS,
  backSectionTarget,
  buildFeedbackEvent,
  flaggedRowIndex,
  nextSectionTarget,
  rowIndexAt,
  sectionGraceMs,
} from '../../../shared/audio-lesson/feedback';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: audio-lesson-feedback <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(977);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function clipFrames(script: AudioLessonScript): Map<string, number> {
  const frames = new Map<string, number>();
  for (const s of script.segments) {
    if (s.kind !== 'speech') continue;
    const key = speechKey(s);
    if (frames.has(key)) continue;
    const perChar = s.lang === 'zh' ? int(9, 16) : int(2, 4);
    frames.set(key, Math.max(8, Math.round((s.text.length * perChar) / s.rate) + int(0, 12)));
  }
  return frames;
}

const SPEEDS = [0.75, 0.9, 1, 1.25, 0, -1, Number.NaN];

const lessons = [
  { name: 'dialogue', script: compileDialogueLesson(SAMPLE_DIALOGUE_PLAN) },
  { name: 'sleep', script: compileSleepLesson(SAMPLE_SLEEP_PLAN, { sourceText: SAMPLE_SLEEP_SOURCE }) },
  { name: 'story', script: compileStoryLesson(SAMPLE_STORY_PLAN) },
].map(({ name, script }) => {
  const timeline = buildTimeline(script, clipFrames(script), 24, 1);
  const rows = transcriptRows(timeline.transcript);
  const end = timeline.duration_ms;
  // Around every row start: the ±1 ms edge and both sides of the grace at each speed; plus random points.
  const at = new Set<number>([0, -500, end, end + 1000]);
  for (const row of rows) for (const d of [-2, -1, 0, 1, 2, 1499, 1500, 1501, 1799, 1800, 1999, 2000, 2001, 2499, 2500, 2501, 4000]) at.add(row.start_ms + d);
  for (let i = 0; i < 150; i++) at.add(Math.round(r() * end * 100) / 100);
  const positions = [...at].sort((a, b) => a - b);
  const queries = positions.map((ms) => {
    const speed = SPEEDS[int(0, SPEEDS.length - 1)];
    return { ms, speed, row: rowIndexAt(rows, ms), back: backSectionTarget(rows, ms, speed), next: nextSectionTarget(rows, ms) };
  });
  const events = positions.filter((_, i) => i % 3 === 0).map((ms, i) => {
    const kind = AUDIO_LESSON_FEEDBACK_KINDS[i % AUDIO_LESSON_FEEDBACK_KINDS.length];
    const speed = SPEEDS[i % 4];
    const event = buildFeedbackEvent({
      id: `ev-${name}-${i}`, lessonId: `al-${name}`, kind, where: 'lock_screen', positionMs: ms, speed, audioVersion: i % 2 ? 'v2' : null,
      createdAt: '2026-11-23T08:00:00.000Z', rows, chapters: timeline.chapters,
    });
    return { kind, ms, speed, event, flagged: flaggedRowIndex(event) };
  });
  return { name, chapters: timeline.chapters, transcript: timeline.transcript, queries, events };
});

// A row longer than the snapshot keeps (a long narration).
const longRows = transcriptRows([
  { start_ms: 0, lang: 'en', voice: 'narrator', text: 'A very long narration. '.repeat(20), chapter: 0 },
  { start_ms: 10_000, lang: 'zh', voice: 'teacher', text: '好'.repeat(400), pinyin: 'hǎo '.repeat(100), english: '', chapter: 0 },
]);
const long = buildFeedbackEvent({ id: 'ev-long', lessonId: 'al-long', kind: 'too_hard', where: 'player', positionMs: 15_000.6, speed: 1, audioVersion: null, createdAt: 'x', rows: longRows, chapters: [] });

writeFileSync(
  join(OUT, 'audio-lesson-feedback.json'),
  JSON.stringify({
    graceMs: BACK_SECTION_GRACE_MS,
    graces: SPEEDS.concat([2, 0.5, 1.1]).map((speed) => ({ speed, ms: sectionGraceMs(speed) })),
    lessons,
    long: { transcript: [
      { start_ms: 0, lang: 'en', voice: 'narrator', text: 'A very long narration. '.repeat(20), chapter: 0 },
      { start_ms: 10_000, lang: 'zh', voice: 'teacher', text: '好'.repeat(400), pinyin: 'hǎo '.repeat(100), english: '', chapter: 0 },
    ], event: long },
  }),
);
