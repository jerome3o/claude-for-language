/**
 * The answer side keeps the question's order (shared/study/answerOrder.ts): the sentences the question side
 * showed first in the order shown (missing keys skipped, duplicates once), then the rest canonical — over
 * seeded random lists with the card's sentence, duplicates and keys no longer in the list.
 * Writes answer-order.json; core AnswerOrderParityTest asserts AnswerOrder.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerSentenceOrder, questionSentenceKeys } from '../../../shared/study/answerOrder';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: answer-order <out-dir>');
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
const r = rng(7613);
const take = (keys: string[], n: number) =>
  Array.from({ length: n }, () => (r() < 0.15 || keys.length === 0 ? `gone${Math.floor(r() * 3)}` : keys[Math.floor(r() * keys.length)]));

const cases = [] as unknown[];
for (let c = 0; c < 300; c++) {
  const n = Math.floor(r() * 9);
  const keys = [...(r() < 0.7 ? [`clue:n${c}`] : []), ...Array.from({ length: n }, (_, i) => `s${c}-${i}`)];
  const listen = r() < 0.6 ? take(keys, Math.floor(r() * 5)) : null;
  const round = r() < 0.5 ? take(keys, Math.floor(r() * 4)) : null;
  const shown = questionSentenceKeys(listen, round);
  cases.push({ keys, listen, round, shown, order: answerSentenceOrder(keys, shown) });
}
writeFileSync(join(OUT, 'answer-order.json'), JSON.stringify({ cases }));
