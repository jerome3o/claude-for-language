/**
 * Golden vectors for package B (mini lessons + graded readers): the web's own
 * shared/lesson answer checking, voices, sample specs and attempt helpers, the
 * exercise helpers in lesson-exercises.tsx, and pickTodaysReader. The Kotlin port
 * (core/…/Lesson*.kt) must reproduce them exactly — LessonParityTest.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeHanziAnswer,
  isHanziAnswerCorrect,
  diffHanzi,
  sentenceUsesWord,
} from '../../../shared/lesson/answer-check';
import { resolveConversationVoices } from '../../../shared/lesson/voices';
import { exercisePoints, countScoreable, lessonTtsTexts, lessonTtsClips, type ConversationSpeaker } from '../../../shared/lesson/types';
import { exercisePrimaryText } from '../../../shared/lesson/diff';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import { formatDuration, sectionTimes, type LessonAttemptData } from '../../../shared/lesson/attempt';

// The frontend modules read Vite's import.meta.env at load time: give the bundle one,
// then load them lazily (esbuild evaluates dynamic imports of bundled modules on demand).
(import.meta as unknown as { env: Record<string, string> }).env ??= {};
const { checkScrambleOrder, isExactHanziMatch } = await import('../../../frontend/src/components/lesson-exercises');
const { pickTodaysReader } = await import('../../../frontend/src/services/reader-study');
const { friendlyReaderError, failedReadersLabel } = await import('../../../frontend/src/services/readerFailures');

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson <out-dir>');
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
const rand = rng(1506);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---- typed answers ----
const expectedPool = [
  '我把作业做完了。', '请把门关上。', '你好', '他昨天去了北京。', '咖啡', '一杯冰咖啡，谢谢！',
  '我们明天见', '这个多少钱？', '她比我高。', 'ＡＢＣ中文', '二〇二六年', '“好的”他说',
];
const noise = ['，', '。', ' ', '　', '!', '？', '…', '“', '”', ' ', '﻿', '~', '+', '¥', '（', '）', 'x', '了', '的', '我'];
function mutate(s: string): string {
  const chars = Array.from(s);
  const out: string[] = [];
  for (const c of chars) {
    const r = rand();
    if (r < 0.08) continue; // drop
    if (r < 0.14) out.push(pick(noise));
    if (r < 0.18) { out.push(pick(Array.from('你我他好是不了在有人大')));
      continue; }
    out.push(c);
  }
  if (rand() < 0.2) out.push(pick(noise));
  return out.join('');
}
const answers: unknown[] = [];
const fixed: Array<[string, string, string[]]> = [
  ['', '你好', []],
  ['   ', '你好', []],
  ['你好！', '你好', []],
  ['您好', '你好', ['您好']],
  ['ＡＢＣ中文', 'ABC中文', []],
  ['我把作业做了', '我把作业做完了。', []],
  ['作业我做完了', '我把作业做完了。', ['作业我做完了。']],
  ['𠀀好', '𠀀好', []],
  ['好好好', '好', []],
  ['', '', []],
  ['。', '', ['', '。']],
];
for (const [a, e, alts] of fixed) answers.push(row(a, e, alts));
for (let i = 0; i < 250; i++) {
  const e = pick(expectedPool);
  const alts = rand() < 0.3 ? [mutate(e)] : [];
  const a = rand() < 0.25 ? e + pick(noise) : mutate(e);
  answers.push(row(a, e, alts));
}
function row(a: string, e: string, alts: string[]) {
  return {
    answer: a,
    expected: e,
    alternatives: alts,
    normalized: normalizeHanziAnswer(a),
    correct: isHanziAnswerCorrect(a, e, alts),
    diff: diffHanzi(a, e, alts),
    uses: sentenceUsesWord(a, Array.from(e).slice(0, 2).join('')),
    exact: isExactHanziMatch(a, e),
  };
}

// ---- scramble ----
const scrambles: unknown[] = [];
const tileSets = [['我', '把', '门', '关上了'], ['你', '去', '哪儿'], ['他 ', ' 很', '高'], ['a', 'b']];
for (let i = 0; i < 80; i++) {
  const correct = pick(tileSets);
  const alt = rand() < 0.4 ? [[...correct].reverse()] : undefined;
  const user = [...correct].sort(() => rand() - 0.5).map(t => (rand() < 0.2 ? ` ${t}` : t));
  scrambles.push({ user, correct, alt: alt ?? null, ok: checkScrambleOrder(user, correct, alt) });
}

// ---- voices ----
const voices: unknown[] = [];
const genders = ['female', 'male', undefined, 'robot'] as const;
for (let i = 0; i < 40; i++) {
  const speakers: ConversationSpeaker[] = Array.from({ length: int(1, 5) }, (_, k) => ({ name: `S${k}`, voice: pick(genders) as never }));
  voices.push({ speakers, voices: resolveConversationVoices(speakers) });
}

// ---- samples: model coverage + spec helpers ----
const samples = SAMPLE_LESSONS.map(s => ({
  id: s.id,
  spec: s.spec,
  count_scoreable: countScoreable(s.spec),
  points: s.spec.sections.flatMap(sec => sec.exercises.map(ex => exercisePoints(ex))),
  primary: s.spec.sections.flatMap(sec => sec.exercises.map(ex => exercisePrimaryText(ex))),
  tts_texts: lessonTtsTexts(s.spec),
  tts_clips: lessonTtsClips(s.spec, resolveConversationVoices).map(c => ({ text: c.text, voice: c.voice ?? null })),
}));

// ---- attempts ----
const durations = [0, 499, 500, 1499, 59_499, 59_500, 60_000, 65_000, 3_599_499, 3_600_000, 3_660_000, 7_265_000, 123_456_789];
const attempts: unknown[] = [];
for (let i = 0; i < 20; i++) {
  const data: LessonAttemptData = {
    started_at: '2026-09-27T10:00:00.000Z',
    duration_ms: int(0, 900_000),
    exercises: Array.from({ length: int(0, 12) }, () => ({
      section: int(0, 3),
      index: int(0, 5),
      type: 'choice',
      correct: pick([true, false, null]),
      points: 0,
      max_points: 1,
      duration_ms: int(-500, 90_000),
    })),
  };
  attempts.push({ data, sections: sectionTimes(data) });
}

// ---- pickTodaysReader ----
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const DAY = 86_400_000;
const readerCases: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const n = int(0, 6);
  const readers = Array.from({ length: n }, (_, k) => {
    const queue = int(0, 3);
    const due = queue === 0 ? null : rand() < 0.1 ? null : T0 + int(-3 * DAY, 3 * DAY);
    return {
      id: `r${k}`,
      title_chinese: '', title_english: '', difficulty_level: 'beginner',
      status: rand() < 0.85 ? 'ready' : pick(['generating', 'failed']),
      created_at: new Date(T0 - int(0, 30) * DAY - int(0, 1000) * 1000).toISOString(),
      pages: rand() < 0.9 ? [{ id: 'p', page_number: 1, content_chinese: '', content_pinyin: '', content_english: '', image_url: null, image_prompt: null }] : [],
      queue,
      stability: 1, difficulty: 5, lapses: 0, interval: 0, repetitions: 0,
      next_review_at: due === null ? (queue === 2 && rand() < 0.5 ? null : null) : new Date(due).toISOString(),
      due_timestamp: due,
      last_reviewed_at: null,
      _synced_at: 0,
    };
  });
  const readToday = new Set(readers.filter(() => rand() < 0.15).map(r => r.id));
  const cutoffTs = T0 + int(0, 12) * 3_600_000;
  const cutoff = { ts: cutoffTs, iso: new Date(cutoffTs).toISOString() };
  const picked = pickTodaysReader(readers as never, readToday, cutoff);
  readerCases.push({
    readers: readers.map(r => ({ id: r.id, status: r.status, pages: r.pages.length, created_at: r.created_at, queue: r.queue, due_timestamp: r.due_timestamp, next_review_at: r.next_review_at })),
    read_today: [...readToday],
    cutoff: cutoffTs,
    picked: picked?.id ?? null,
  });
}

const failureMessages = [
  null, '', 'ANTHROPIC_API_KEY not configured', 'HTTP 401', 'Request timed out after 30s', 'Deadline exceeded',
  'Rate limit reached', 'overloaded_error 529', 'Service Unavailable 503', 'Not enough learned vocabulary',
  'fetch failed', 'ECONNRESET', 'socket hang up', 'TypeError: x is undefined', 'Too few words', 'The model is BUSY',
];
const failures = failureMessages.map(m => ({ raw: m, text: friendlyReaderError(m) }));
const labels = [0, 1, 2, 38].map(n => ({ n, text: failedReadersLabel(n) }));

writeFileSync(join(OUT, 'lesson.json'), JSON.stringify({
  failures,
  labels,
  answers,
  scrambles,
  voices,
  samples,
  durations: durations.map(ms => ({ ms, text: formatDuration(ms) })),
  attempts,
  readers: readerCases,
}));
