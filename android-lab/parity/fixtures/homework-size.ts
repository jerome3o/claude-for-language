/**
 * Golden vectors for homework sizes (shared/homework/size.ts): "18 exercises · ~12 min",
 * "5 questions · ~4 min", "12 words", "6 pages". Writes homework-size.json; checked by
 * core/…/HomeworkSizeParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deckSizeLabel, exerciseMinutes, lessonSizeLabel, readerSizeLabel, revisionSizeLabel, EXERCISE_SECONDS } from '../../../shared/homework/size';

const OUT = process.argv[2];
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
const r = rng(20261024);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TYPES = [...Object.keys(EXERCISE_SECONDS), 'mystery'];

const cases = Array.from({ length: 200 }, () => {
  const types = Array.from({ length: int(0, 25) }, () => TYPES[int(0, TYPES.length - 1)]);
  const n = int(-1, 30);
  return {
    types,
    n,
    minutes: exerciseMinutes(types),
    lesson: lessonSizeLabel(types),
    revision: revisionSizeLabel(n, types),
    deck: deckSizeLabel(n),
    reader: readerSizeLabel(n),
  };
});

writeFileSync(join(OUT, 'homework-size.json'), JSON.stringify({ seconds: EXERCISE_SECONDS, cases }));
