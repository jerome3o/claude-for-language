/**
 * Golden vectors for "▶ Watch the intro" (shared/lesson/patternIntro.ts): per structure card of the real notes,
 * the catalogue sample and seeded variations (intros of 0–7 lines, 0–4 examples) — the voice-over, the intro clip,
 * its utterances, the note's prefetch texts and the lit part over time. Writes lesson-pattern-intro.json; checked by
 * core/…/LessonPatternIntroParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clipUtterances } from '../../../shared/clips/timeline';
import { structureNoteView, type StructureCard } from '../../../shared/lesson/pattern';
import { introLitPart, patternIntroClip, patternIntroLines, patternIntroTexts } from '../../../shared/lesson/patternIntro';
import { ALL_STRUCTURES_NOTE, ALL_STRUCTURES_NOTE_2, STRUCTURE_FOUR_NOTE, STRUCTURE_ONE_NOTE } from '../../../shared/lesson/__fixtures__/structures';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import { exerciseTtsTexts, type NoteExercise, type PatternIntroLine } from '../../../shared/lesson/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-pattern-intro <out-dir>');
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
const r = rng(20261117);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const sampleNotes = SAMPLE_LESSONS.flatMap((l) => l.spec.sections.flatMap((s) => s.exercises)).filter((e): e is NoteExercise => e.type === 'note');
const notes: NoteExercise[] = [ALL_STRUCTURES_NOTE, ALL_STRUCTURES_NOTE_2, STRUCTURE_ONE_NOTE, STRUCTURE_FOUR_NOTE, ...sampleNotes];
const baseCards: StructureCard[] = notes.flatMap((n) => structureNoteView(n)?.cards ?? []);

const LINES: PatternIntroLine[] = [
  { zh: '今天我们学一个新句型。', en: 'A new structure today.' }, { zh: '我们听一个例子。' }, { zh: '  再听一个。 ', en: ' One more. ' },
  { zh: '', en: 'empty' }, { zh: '现在你试一试！', en: '' }, { zh: '这个很有用。', en: 'This is useful.' },
];
const cards: StructureCard[] = [...baseCards];
for (let i = 0; i < 80; i++) {
  const base = pick(baseCards);
  const n = Math.floor(r() * 8);
  const intro = n === 0 ? undefined : Array.from({ length: n }, () => pick(LINES));
  const examples = base.examples.slice(0, Math.floor(r() * 5));
  cards.push({ ...base, pattern: { ...base.pattern, ...(intro ? { intro } : {}) }, examples });
}

const intros = cards.map((card) => {
  const clip = patternIntroClip(card);
  return { card, lines: patternIntroLines(card), clip, texts: clipUtterances(clip).map((u) => u.text) };
});
const notesOut = notes.filter((note) => structureNoteView(note)).map((note) => ({ note, texts: exerciseTtsTexts(note), intro: patternIntroTexts(structureNoteView(note)!) }));
const lit = baseCards.flatMap((c) => c.examples.map((e) => ({
  parts: e.parts,
  duration: 3200,
  at: [0, 150, 400, 800, 1200, 1600, 2000, 2600, 3100, 4000].map((ms) => ({ ms, part: introLitPart(e.parts, ms, 3200) })),
})));

writeFileSync(join(OUT, 'lesson-pattern-intro.json'), JSON.stringify({ intros, notes: notesOut, lit }));
