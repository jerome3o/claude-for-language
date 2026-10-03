/**
 * Golden vectors: taking homework back (shared/homework/removal.ts) — the ⋯ menu item, the
 * Undo label, the confirm sheet's words and the toast. Writes homework-removal.json; checked by
 * core/…/HomeworkRemovalParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  removalCopy,
  removalMenuLabel,
  removalToast,
  removalUndoLabel,
  studentFirstName,
  type RemovalFacts,
  type RemovalKind,
} from '../../../shared/homework/removal';

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
const r = rng(20261003);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const NAMES: (string | null)[] = [
  'Jerome Swannack', 'Jerome', '  Jerome  Swannack ', '', '   ', null, '明慧', '王 小明',
  '　Minghui　Li', 'Ana Maria', 'Jean-Luc\tPicard', '\nLi\nWei', '﻿Zoë',
];
const KINDS: RemovalKind[] = ['deck', 'lesson', 'reader'];
const TITLES = ['HSK 1（新版 3.0）_生字表', 'HSK 1', 'Lesson 8', 'Tones', '小猫', '', 'Week 3 · “quotes”'];

const fixed: { facts: RemovalFacts; name: string | null }[] = [
  { facts: { kind: 'deck', title: 'HSK 1', words_met: 0, words_total: 319, can_delete_source: true }, name: 'Jerome' },
  { facts: { kind: 'deck', title: 'Lesson 8', words_met: 12, words_total: 40 }, name: 'Jerome' },
  { facts: { kind: 'lesson', title: 'Tones', times: 0 }, name: 'Jerome' },
  { facts: { kind: 'lesson', title: 'Tones', times: 2 }, name: 'Jerome' },
  { facts: { kind: 'reader', title: '小猫', times: 3 }, name: 'Jerome' },
  { facts: { kind: 'reader', title: '小猫', times: 1, can_delete_source: true }, name: 'Jerome' },
  { facts: { kind: 'deck', title: 'X', copy_gone: true }, name: 'Jerome' },
  { facts: { kind: 'deck', title: 'X' }, name: null },
  { facts: { kind: 'lesson', title: 'L' }, name: '' },
];

function randomFacts(): RemovalFacts {
  const kind = pick(KINDS);
  const f: RemovalFacts = { kind, title: pick(TITLES) };
  if (kind === 'deck') {
    if (r() < 0.9) f.words_total = int(0, 400);
    if (r() < 0.9) f.words_met = int(0, f.words_total ?? 50);
  } else if (r() < 0.9) {
    f.times = pick([0, 0, 1, 2, 3, int(4, 40)]);
  }
  if (r() < 0.2) f.copy_gone = r() < 0.8;
  if (r() < 0.6) f.can_delete_source = r() < 0.7;
  return f;
}

const cases = [...fixed, ...Array.from({ length: 200 }, () => ({ facts: randomFacts(), name: pick(NAMES) }))].map(({ facts, name }) => ({
  facts,
  name,
  copy: removalCopy(facts, name),
}));

const names = NAMES.map((name) => ({
  name,
  first: studentFirstName(name),
  undo: removalUndoLabel(name),
  menu: KINDS.map((k) => removalMenuLabel(k, name)),
}));

const toasts = Array.from({ length: 60 }, () => {
  const kind = pick(KINDS);
  const title = pick(TITLES);
  const name = pick(NAMES);
  const sourceDeleted = r() < 0.5;
  return { kind, title, name, sourceDeleted, text: removalToast(kind, title, name, sourceDeleted) };
});

writeFileSync(join(OUT, 'homework-removal.json'), JSON.stringify({ cases, names, toasts }));
