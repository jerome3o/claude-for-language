/**
 * Package J golden vectors: board page labels and titles (shared/calls/pages.ts).
 * Writes calls-pages.json; checked by core/…/calls/CallsPagesParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pageLabel, sanitizePageTitle, MAX_PAGE_TITLE } from '../../../shared/calls/pages';

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
const r = rng(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const fixed: Array<string | null> = [
  null, '', ' ', '\n', '\t\t', '　', ' ', '﻿', 'Tones', '  Tones  ', 'Lesson 3\nverbs', 'a\r\nb', 'a \t b', 'a　　b',
  '把字句', ' 把字句 · review ', 'x'.repeat(59), 'x'.repeat(60), 'x'.repeat(61), '好'.repeat(70), '𠀀'.repeat(61), `${'a'.repeat(59)}𠀀b`,
  'Page 7', ' line sep', 'emoji 😀 ok', ' \n ',
];
const alphabet = ['a', 'B', ' ', '  ', '\n', '\r', '\t', '　', ' ', '好', '𠀀', '😀', '-', '·', ' ', '﻿', 'Page'];
const random: string[] = [];
for (let i = 0; i < 600; i++) {
  const n = Math.floor(r() * 80);
  let t = '';
  for (let k = 0; k < n; k++) t += pick(alphabet);
  random.push(t);
}

const titles = [...fixed, ...random].map((raw) => ({ raw, title: sanitizePageTitle(raw) }));
const labels = [...fixed, ...random.slice(0, 200)].map((title, i) => {
  const index = i % 13;
  return { index, title, label: pageLabel(index, title) };
});

writeFileSync(join(OUT, 'calls-pages.json'), JSON.stringify({ maxTitle: MAX_PAGE_TITLE, titles, labels }));
