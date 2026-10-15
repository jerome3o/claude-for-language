/**
 * Lesson audio clips (shared/lesson/audioClips.ts): every clip a lesson plays
 * (lessonAudioClips over every sample lesson — one per exercise type — with conversations
 * resolved by resolveConversationAudio), the clip id, the prefetch order from a given
 * exercise and which lessons the sync prefetches (lessonsToPrefetch). Writes
 * lesson-audio.json; checked by core/…/LessonAudioClipsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  distinctLessonClips,
  lessonAudioClips,
  lessonClipId,
  lessonsToPrefetch,
  orderClipsForPrefetch,
  type PrefetchLessonRow,
} from '../../../shared/lesson/audioClips';
import { resolveConversationAudio, DEFAULT_CONVERSATION_AUDIO_PREFS } from '../../../shared/lesson/conversationAudio';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import type { CustomLessonSpec } from '../../../shared/lesson/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-audio <out-dir>');
mkdirSync(OUT, { recursive: true });

let s = 0x1e55_0a0d;
function rnd(): number {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

const ctxs = [
  { provider: 'minimax' as const, default_speed: 0.85, enabled: null, prefs: DEFAULT_CONVERSATION_AUDIO_PREFS },
  { provider: 'azure' as const, default_speed: 0.75, enabled: null, prefs: { ...DEFAULT_CONVERSATION_AUDIO_PREFS, speed: 0.6, delivery: 'calm' as const } },
];

// One lesson holding every sample's exercises, plus a duplicate-heavy one.
const big: CustomLessonSpec = {
  title: 'All types',
  sections: SAMPLE_LESSONS.map((sample) => ({ title: sample.spec.title, exercises: sample.spec.sections.flatMap((x) => x.exercises) })),
};
const dup: CustomLessonSpec = {
  title: 'Dupes',
  sections: [
    { exercises: [{ type: 'translate', english: 'a', reference_hanzi: '你好。' }, { type: 'choice', question: 'q', options: [{ hanzi: '你好。' }, { hanzi: ' ' }, { hanzi: '再见。' }], correct: 0 }] },
    { exercises: [{ type: 'note', body: 'b', sentences: [{ hanzi: '再见。' }, { hanzi: '谢谢。' }] }] },
  ],
} as unknown as CustomLessonSpec;
const specs = [big, dup, ...SAMPLE_LESSONS.map((x) => x.spec)];

const lessons = specs.flatMap((spec, i) =>
  ctxs.map((ctx, ci) => {
    const resolve = ci === 0 && i === 0 ? undefined : (ex: Parameters<typeof resolveConversationAudio>[0]) => resolveConversationAudio(ex, ctx);
    const clips = lessonAudioClips(spec, resolve);
    const exercises = spec.sections.reduce((n, x) => n + x.exercises.length, 0);
    const currents = [0, 1, int(0, exercises), exercises + 2];
    return {
      spec,
      ctx: resolve ? ctx : null,
      clips,
      ids: clips.map(lessonClipId),
      distinct: distinctLessonClips(spec, resolve),
      orders: currents.map((current) => ({ current, clips: orderClipsForPrefetch(clips, current) })),
    };
  }),
);

// ---- which lessons the sync prefetches ----
const prefetch = Array.from({ length: 60 }, () => {
  const n = int(0, 12);
  const rows: PrefetchLessonRow[] = Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    created_at: `2026-10-${String(int(1, 9)).padStart(2, '0')}T0${int(0, 9)}:00:00Z`,
    finishes: pick([0, 0, 0, 1, 3]),
    retired: rnd() < 0.15,
    lock: pick(['none', 'none', 'none', 'locked', 'unlocked'] as const),
  }));
  const ids = [...rows.map((r) => r.id), 'gone'];
  const todays = Array.from({ length: int(0, 3) }, () => pick(ids));
  const homework = Array.from({ length: int(0, 4) }, () => ({
    kind: pick(['lesson', 'lesson', 'reader', 'deck']),
    target_id: pick(ids),
    status: pick(['active', 'active', 'done', 'cancelled']),
  }));
  const upcoming = pick([undefined, 0, 1, 3, 5]);
  return { rows, todays, homework, upcoming: upcoming ?? null, result: lessonsToPrefetch({ todays, homework, lessons: rows, upcomingNew: upcoming }) };
});

const nullish = (c: object) => JSON.parse(JSON.stringify(c, (_, v) => (v === undefined ? null : v)));
writeFileSync(join(OUT, 'lesson-audio.json'), JSON.stringify(nullish({ lessons, prefetch })));
console.log(`lesson-audio: ${lessons.length} lessons, ${prefetch.length} prefetch picks`);
