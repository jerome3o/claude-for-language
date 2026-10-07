/**
 * Audio lessons: the player's pure helpers (shared/audio-lesson/timeline.ts) over realistic
 * timelines — the sample dialogue and sleep plans compiled with the web's own compiler and
 * timed by buildTimeline with seeded clip lengths (24 ms frames, one lead frame, like the
 * worker's MP3). Writes audio-lesson.json; core AudioLessonParityTest asserts
 * AudioLessonTimeline.kt matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIO_LESSON_SPEEDS,
  MUSIC_DEFAULT_VOLUME,
  MUSIC_MAX_VOLUME,
  MUSIC_MIN_VOLUME,
  musicDefaultOn,
  musicOutputVolume,
  musicShouldPlay,
  musicVolumeLabel,
  parseMusicOn,
  parseMusicVolume,
  SLEEP_FADE_MS,
  SLEEP_TIMER_CHOICES,
  SAMPLE_DIALOGUE_PLAN,
  SAMPLE_SLEEP_PLAN,
  SAMPLE_SLEEP_SOURCE,
  buildTimeline,
  chapterIndexAt,
  compileDialogueLesson,
  compileSleepLesson,
  durationLabel,
  formatClock,
  previousChapterTarget,
  sleepFadeVolume,
  sleepTimerLabel,
  speechKey,
  transcriptIndexAt,
  transcriptRows,
  type AudioLessonScript,
} from '../../../shared/audio-lesson';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: audio-lesson <out-dir>');
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
const r = rng(541);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** Frames per distinct clip: roughly the text's spoken length, with some noise. */
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

const lessons = [
  { name: 'dialogue', script: compileDialogueLesson(SAMPLE_DIALOGUE_PLAN) },
  { name: 'sleep', script: compileSleepLesson(SAMPLE_SLEEP_PLAN, { sourceText: SAMPLE_SLEEP_SOURCE }) },
].map(({ name, script }) => {
  const timeline = buildTimeline(script, clipFrames(script), 24, 1);
  const end = timeline.duration_ms;
  // Positions: every chapter / line start and its neighbours (the ±1 ms edge, the 3 s grace), plus random ones.
  const at = new Set<number>([0, -500, 1, end, end + 1000]);
  for (const c of timeline.chapters) for (const d of [-2, -1, 0, 1, 2, 500, 2999, 3000, 3001, 4500]) at.add(c.start_ms + d);
  for (const l of timeline.transcript) for (const d of [-2, -1, 0, 1, 2]) at.add(l.start_ms + d);
  for (let i = 0; i < 300; i++) at.add(r() * end);
  const queries = [...at].sort((a, b) => a - b).map((ms) => ({
    ms,
    chapter: chapterIndexAt(timeline.chapters, ms),
    line: transcriptIndexAt(timeline.transcript, ms),
    previous: previousChapterTarget(timeline.chapters, ms),
  }));
  return { name, chapters: timeline.chapters, transcript: timeline.transcript, duration_ms: end, rows: transcriptRows(timeline.transcript), queries };
});

// Hand-made transcripts for transcriptRows' edges: narration split around Chinese, punctuation glue, chapter breaks.
const L = (start_ms: number, lang: 'zh' | 'en', voice: string, text: string, chapter = 0, pinyin?: string, english?: string) => ({
  start_ms, lang, voice: voice as 'narrator', text, chapter, ...(pinyin ? { pinyin } : {}), ...(english ? { english } : {}),
});
const rowCases = [
  [L(0, 'en', 'narrator', "You're at a"), L(800, 'zh', 'teacher', '兰州拉面'), L(1500, 'en', 'narrator', 'place.'), L(2200, 'en', 'narrator', 'Listen.')],
  [L(0, 'en', 'narrator', 'Its opposite is'), L(900, 'zh', 'teacher', '细'), L(1300, 'en', 'narrator', ', thin.')],
  [L(0, 'en', 'narrator', 'He said "go":'), L(600, 'zh', 'teacher', '走')],
  [L(0, 'en', 'narrator', 'A quote "ends."'), L(600, 'en', 'narrator', 'Next')],
  [L(0, 'en', 'narrator', 'Not closed'), L(600, 'en', 'narrator', 'but new chapter', 1)],
  [L(0, 'en', 'narrator', 'Trailing space   '), L(600, 'en', 'narrator', 'joins')],
  [L(0, 'en', 'narrator', 'Ends with paren (yes)'), L(600, 'en', 'narrator', 'joins too')],
  [L(0, 'zh', 'teacher', '粗', 0, 'cū'), L(400, 'zh', 'teacher', '粗', 0, 'cū'), L(800, 'en', 'narrator', 'thick')],
  [L(0, 'zh', 'speaker_a', '你好，吃什么？', 0, 'nǐ hǎo', 'Hi'), L(900, 'zh', 'speaker_b', '我要一碗牛肉面。', 0, 'wǒ yào', 'A bowl')],
  [L(0, 'en', 'narrator', 'Ask for'), L(500, 'zh', 'teacher', '细的'), L(900, 'en', 'narrator', '!'), L(1200, 'en', 'narrator', 'Done')],
  // Sleep recap: the sleep voice's word right after the recap voice joins its row; one before it does not.
  [L(0, 'zh', 'sleep', '邮局几点开门？', 0, 'yóujú', 'When?'), L(900, 'zh', 'sleep', '邮局几点开门？'), L(1800, 'en', 'recap', 'The word was'), L(2400, 'zh', 'sleep', '邮局'), L(2900, 'en', 'recap', ': post office.'), L(4000, 'zh', 'sleep', '这是一个新词。', 1)],
  [L(0, 'zh', 'sleep', '这是一个新词。'), L(900, 'zh', 'sleep', '我说三遍。'), L(1800, 'zh', 'sleep', '寄')],
  [L(0, 'en', 'recap', 'The word was'), L(600, 'zh', 'sleep', '寄', 1), L(900, 'en', 'recap', ': to post.', 1)],
  [L(0, 'en', 'recap', 'The word was'), L(600, 'zh', 'sleep', '寄', 0, 'jì'), L(900, 'en', 'recap', ': to post.')],
  // Repeats: one row "×N" (same voice, same chapter, straight after itself); a translation joins the row it translates.
  [L(0, 'zh', 'sleep', '寄', 0, 'jì', 'to post'), L(500, 'zh', 'sleep', '寄'), L(1000, 'zh', 'sleep', '寄'), L(1500, 'zh', 'sleep', '寄，第四声。')],
  [L(0, 'zh', 'sleep', '我想寄信。', 0, 'wǒ xiǎng jì xìn.', 'I want to send a letter'), L(900, 'zh', 'sleep', '我想寄信。'), L(1800, 'zh', 'sleep', '我想寄信。'), L(2700, 'en', 'recap', 'I want to send a letter.'), L(3600, 'zh', 'sleep', '寄到北京。', 0, 'jì dào Běijīng.', 'Send it to Beijing.'), L(4500, 'en', 'recap', 'Send it to Beijing')],
  [L(0, 'zh', 'sleep', '好。'), L(500, 'zh', 'teacher', '好。'), L(1000, 'zh', 'teacher', '好。', 1), L(1500, 'zh', 'teacher', '好。', 1)],
  [L(0, 'zh', 'sleep', '你好。', 0, 'nǐ hǎo', 'Hello!'), L(400, 'en', 'recap', 'Hello?'), L(800, 'en', 'recap', '  hello  ')],
  [L(0, 'en', 'narrator', 'Again'), L(400, 'en', 'narrator', 'Again')],
  [],
].map((lines) => ({ lines, rows: transcriptRows(lines as never) }));

const clocks = [0, -1, -5000, 999, 1000, 59_999, 60_000, 65_400, 599_999, 3_599_999, 3_600_000, 3_723_000, 36_000_000, 1234.5, 45_678.9]
  .concat(Array.from({ length: 60 }, () => Math.round(r() * 7_200_000 * 100) / 100))
  .map((ms) => ({ ms, clock: formatClock(ms), duration: durationLabel(ms) }));

const fades = [SLEEP_FADE_MS, SLEEP_FADE_MS + 1, 40_000, 29_999, 15_000, 7_500, 1, 0.5, 0, -1, -10_000]
  .concat(Array.from({ length: 40 }, () => r() * 40_000 - 2000))
  .map((ms) => ({ ms, volume: sleepFadeVolume(ms) }));

writeFileSync(
  join(OUT, 'audio-lesson.json'),
  JSON.stringify({
    lessons,
    rowCases,
    clocks,
    fades,
    speeds: AUDIO_LESSON_SPEEDS,
    timer: SLEEP_TIMER_CHOICES.map((m) => ({ minutes: m, label: sleepTimerLabel(m) })),
    fadeMs: SLEEP_FADE_MS,
    music: {
      defaultVolume: MUSIC_DEFAULT_VOLUME,
      minVolume: MUSIC_MIN_VOLUME,
      maxVolume: MUSIC_MAX_VOLUME,
      defaults: ['sleep', 'dialogue', null, 'other'].map((format) => ({ format, on: musicDefaultOn(format) })),
      on: [null, '1', '0', 'yes', ''].flatMap((raw) => ['sleep', 'dialogue', null].map((format) => ({ raw, format, on: parseMusicOn(raw, format) }))),
      volumes: [null, 0, 0.01, 0.05, 0.333, 0.335, 0.35, 0.5, 0.999, 1, 1.5, -2]
        .concat(Array.from({ length: 30 }, () => Math.round(r() * 120) / 100))
        .map((raw) => ({ raw, volume: parseMusicVolume(raw), label: musicVolumeLabel(raw ?? Number.NaN) })),
      outputs: [[0.35, 1], [0.35, 0.5], [0.6, 0], [2, 2], [-1, 1], [0.35, 0.3333]]
        .concat(Array.from({ length: 30 }, () => [Math.round(r() * 100) / 100, r()]))
        .map(([volume, fade]) => ({ volume, fade, out: musicOutputVolume(volume, fade) })),
      plays: [true, false].flatMap((on) => [true, false].map((lessonPlaying) => ({ on, lessonPlaying, play: musicShouldPlay({ on, lessonPlaying }) }))),
    },
  }),
);
