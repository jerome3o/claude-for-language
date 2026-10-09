/**
 * Unlockable mini lessons (shared/lesson/unlock.ts): lock status, the earliest unlock, "listened
 * to the end", which lessons a listen unlocks, the lock sets and the words — over seeded cases.
 * Writes lesson-unlock.json; core LessonUnlockParityTest asserts LessonUnlock.kt matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  audioLessonListened,
  companionBadge,
  companionLessonTitle,
  companionReadyLine,
  earlierUnlock,
  lessonLockStatus,
  lessonsUnlockedByListen,
  lockedLessonLine,
  lockSets,
  unlockButtonLabel,
  type CompanionStatus,
  type LessonUnlock,
} from '../../../shared/lesson/unlock';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-unlock <out-dir>');
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
const rand = rng(20261009);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const TIMES = [null, '', 'garbage', '2026-10-09T08:00:00.000Z', '2026-10-09T09:30:00.000Z', '2026-10-08T23:59:59.999Z', '2026-10-09 08:00:00', '2026-10-09'];
const AUDIO = ['al1', 'al2', 'al3'];

function randomUnlock(): LessonUnlock | null {
  const r = rand();
  if (r < 0.3) return null;
  if (r < 0.75) return { kind: 'audio_lesson', audio_lesson_id: pick(AUDIO) };
  return { kind: 'manual', prompt: pick(['Watch episode 3 of 家有儿女', 'Go to a restaurant and order 打包', 'Call your friend in Chinese']) };
}

const statuses: unknown[] = [];
for (let i = 0; i < 60; i++) {
  const unlock = randomUnlock();
  const at = pick(TIMES);
  statuses.push({ unlock, unlocked_at: at, status: lessonLockStatus(unlock, at) });
}

const earlier: unknown[] = [];
for (const a of TIMES) for (const b of TIMES) earlier.push({ a, b, out: earlierUnlock(a, b) });

const listened: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const duration = pick([0, -1, 600_000, 1_234_567, int(60_000, 3_600_000)]);
  const n = int(0, 8);
  const starts = Array.from({ length: n }, (_, k) => (k === 0 ? 0 : int(1, Math.max(1, duration)))).sort((x, y) => x - y);
  const position = pick([0, -5, duration * 0.85, duration * 0.85 - 1, int(0, Math.max(1, duration)), starts[starts.length - 1] ?? 0, (starts[starts.length - 1] ?? 0) - 1]);
  listened.push({ position, duration, starts, out: audioLessonListened(position, duration, starts) });
}

const listens: unknown[] = [];
for (let i = 0; i < 150; i++) {
  const lessons = Array.from({ length: int(0, 8) }, (_, k) => ({ id: `L${k}`, unlock: randomUnlock(), unlocked_at: pick([null, null, '2026-10-09T08:00:00.000Z']) }));
  const audio = pick(AUDIO);
  const sets = lockSets(lessons);
  listens.push({ lessons, audio, unlocked_by_listen: lessonsUnlockedByListen(lessons, audio), locked: [...sets.locked], unlocked: [...sets.unlocked] });
}

const words = {
  titles: ["去朋友家吃饭 · Dinner at a friend's parents' home", '  在   咖啡馆  ', '', 'X — mini lesson', 'X — mini lesson '].map(t => ({ in: t, out: companionLessonTitle(t) })),
  buttons: [{ kind: 'audio_lesson', audio_lesson_id: 'a' }, { kind: 'manual', prompt: 'p' }].map(u => ({ unlock: u, out: unlockButtonLabel(u as LessonUnlock) })),
  lines: [
    { unlock: { kind: 'audio_lesson', audio_lesson_id: 'a' }, audio_title: '去朋友家吃饭' },
    { unlock: { kind: 'audio_lesson', audio_lesson_id: 'a' }, audio_title: null },
    { unlock: { kind: 'audio_lesson', audio_lesson_id: 'a' }, audio_title: '  ' },
    { unlock: { kind: 'manual', prompt: 'Order 打包' }, audio_title: null },
  ].map(c => ({ ...c, out: lockedLessonLine(c.unlock as LessonUnlock, c.audio_title) })),
  badges: (['generating', 'failed', 'locked', 'unlocked'] as CompanionStatus[]).map(s => ({ status: s, out: companionBadge(s) })),
  ready: [{ title: '去朋友家吃饭 — mini lesson', out: companionReadyLine('去朋友家吃饭 — mini lesson') }],
};

writeFileSync(join(OUT, 'lesson-unlock.json'), JSON.stringify({ statuses, earlier, listened, listens, words }));
console.log(`lesson-unlock: ${statuses.length} statuses, ${earlier.length} earlier, ${listened.length} listened, ${listens.length} listens`);
