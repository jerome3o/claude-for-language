/**
 * Golden vectors: create, then send (shared/homework/send.ts) — which items of a session-notes job
 * are still unsent, the Send buttons, the confirm line and the toast. Writes homework-send.json;
 * checked by core/…/HomeworkSendParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sendAllLabel, sendConfirmText, sendToLabel, sentToast, unsentJobItems, type JobResultLike } from '../../../shared/homework/send';

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
const r = rng(20261004);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const NAMES: (string | null)[] = ['Jerome Swannack', 'Jerome', '  Jerome  Swannack ', '', '   ', null, '明慧', '王 小明', '　Minghui　Li', 'Jean-Luc\tPicard'];
const TITLES = ['饭馆', 'HSK 1（新版 3.0）_生字表', 'At the restaurant', '把 sentences', '', 'Week 3 · “quotes”', 'a "b" c'];
// An id-like field: absent, empty (JS-falsy) or set.
const maybeId = (): string | undefined => pick([undefined, undefined, undefined, '', 'x1', 'copy-9']);

function randomResult(): JobResultLike | null {
  if (r() < 0.05) return null;
  const res: JobResultLike = {};
  if (r() < 0.7) {
    const deck: NonNullable<JobResultLike['deck']> = { id: `d${int(1, 99)}`, name: pick(TITLES), note_count: pick([0, 0, 1, 3, int(4, 60)]) };
    const t = maybeId();
    if (t !== undefined) deck.target_deck_id = t;
    const rm = maybeId();
    if (rm !== undefined) deck.removed_at = rm;
    res.deck = deck;
  }
  if (r() < 0.8) {
    res.lessons = Array.from({ length: int(0, 3) }, (_, i) => {
      const l: NonNullable<JobResultLike['lessons']>[number] = { library_item_id: `li${i}-${int(1, 99)}`, title: pick(TITLES) };
      const id = maybeId();
      if (id !== undefined) l.lesson_id = id;
      const rm = maybeId();
      if (rm !== undefined) l.removed_at = rm;
      return l;
    });
  }
  if (r() < 0.5) {
    const reader: NonNullable<JobResultLike['reader']> = { id: `r${int(1, 99)}`, title_english: pick(TITLES) };
    const t = maybeId();
    if (t !== undefined) reader.target_reader_id = t;
    const rm = maybeId();
    if (rm !== undefined) reader.removed_at = rm;
    res.reader = reader;
  }
  return res;
}

const results = Array.from({ length: 200 }, () => {
  const result = randomResult();
  return { result, unsent: unsentJobItems(result) };
});

const labels = NAMES.flatMap((name) => [0, 1, 2, 3, 12].map((count) => ({ name, count, sendTo: sendToLabel(name), sendAll: sendAllLabel(count, name) })));

const copy = Array.from({ length: 80 }, () => {
  const titles = Array.from({ length: pick([1, 1, 1, 2, 3, int(0, 5)]) }, () => pick(TITLES));
  const name = pick(NAMES);
  return { titles, name, confirm: sendConfirmText(titles, name), toast: sentToast(titles, name) };
});

writeFileSync(join(OUT, 'homework-send.json'), JSON.stringify({ results, labels, copy }));
