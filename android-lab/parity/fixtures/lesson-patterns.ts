/**
 * Golden vectors for structure cards (shared/lesson/pattern.ts): the note → cards view (a note's own
 * patterns, or structures parsed from older free text with the example sentences matched and coloured),
 * the pattern-line parser, the example aligner, colour roles, slot classes, teaching-text blocks and
 * the editor's text round trip — over real notes plus seeded variations. Writes lesson-patterns.json;
 * checked by core/…/LessonPatternsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  alignPatternExample, mergePieceDetails, noteTextBlocks, parsePatternLine, patternEditText, patternLine, patternName,
  pieceTones, slotClass, structureNoteView,
} from '../../../shared/lesson/pattern';
import { ALL_STRUCTURES_NOTE, ALL_STRUCTURES_NOTE_2, PLAIN_NOTES, STRUCTURE_FOUR_NOTE, STRUCTURE_ONE_NOTE } from '../../../shared/lesson/__fixtures__/structures';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import type { LessonPattern, NoteExercise, PatternPiece } from '../../../shared/lesson/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: lesson-patterns <out-dir>');
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
const r = rng(20261116);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (p: number) => r() < p;

const sampleNotes = SAMPLE_LESSONS.flatMap((l) => l.spec.sections.flatMap((s) => s.exercises)).filter((e): e is NoteExercise => e.type === 'note');
const realNotes: NoteExercise[] = [ALL_STRUCTURES_NOTE, ALL_STRUCTURES_NOTE_2, STRUCTURE_ONE_NOTE, STRUCTURE_FOUR_NOTE, ...PLAIN_NOTES, ...sampleNotes];
const allSentences = realNotes.flatMap((n) => [...(n.sentences ?? []), ...(n.patterns ?? []).flatMap((p) => p.examples ?? [])]);

// ---- seeded variations of the free-text notes
const EXTRA_LINES = ['', 'Usage', '✗ 二十个多学生', '✓ 二十多个学生', '→ besides A, also B', 'V + 得 + Adj', 'Subj + V不V + O', '1. 越来越 + 形容词',
  '- 把 + 宾语 + 动词 + 在 + 地点', '好 before a verb + it describes', '（不）好 + 动词', '常见错误', '这是一个句子。', 'A 比 B + 形容词', '从 + 时间 + 开始'];
function vary(note: NoteExercise): NoteExercise {
  const lines = (note.body ?? '').split('\n');
  const ops = 1 + Math.floor(r() * 4);
  for (let k = 0; k < ops; k++) {
    const x = r();
    if (x < 0.3 && lines.length > 1) lines.splice(Math.floor(r() * lines.length), 1);
    else if (x < 0.6) lines.splice(Math.floor(r() * (lines.length + 1)), 0, pick(EXTRA_LINES));
    else if (x < 0.8 && lines.length > 1) { const i = Math.floor(r() * lines.length); const [l] = lines.splice(i, 1); lines.splice(Math.floor(r() * lines.length), 0, l); }
    else { const i = Math.floor(r() * lines.length); lines[i] = lines[i].replace(/[+]/g, '＋'); }
  }
  const sentences = (note.sentences ?? []).filter(() => chance(0.85));
  if (chance(0.4)) sentences.push(pick(allSentences));
  return { ...note, body: lines.join('\n'), sentences };
}
const notes: NoteExercise[] = [...realNotes];
for (let i = 0; i < 150; i++) notes.push(vary(pick([ALL_STRUCTURES_NOTE, ALL_STRUCTURES_NOTE_2, STRUCTURE_ONE_NOTE, STRUCTURE_FOUR_NOTE])));
const views = notes.map((note) => ({ note, view: structureNoteView(note) }));

// ---- parser lines
const LINES = [
  ...realNotes.flatMap((n) => (n.body ?? '').split('\n')),
  ...EXTRA_LINES,
  '动词＋回／上／下＋地点＋来／去', '① 除了 + 名词 + (以外), 主语 + 还 + 动词', '② V + 了 + 时段 + 的 + N', 'Adj + 起来了', '(不) 好 + V',
  '名词 + 动词', '我 + 你 = 我们。', '把 + sb + 叫做 + sth', '一 + V + 就 + V', '越 + Adj + 越 + Adj', '一边 + V + 一边 + V',
  'constructor + 的 + toString', '因为 + 名词 + 动词，所以 + 句子',
];
const parse = LINES.map((line, i) => {
  const english = i % 3 === 0 ? pick(['Verb + back + Place + come', 'Besides + Noun + also + Verb', '(not) easy to + Verb', '']) : null;
  return { line, english, out: parsePatternLine(line, english) };
});

// ---- the aligner over every structure × every sentence we have
const patterns: LessonPattern[] = [
  ...views.flatMap((v) => v.view?.cards.map((c) => c.pattern) ?? []).slice(0, 40),
  ...sampleNotes.flatMap((n) => n.patterns ?? []),
];
const sentences = [...new Set(allSentences.map((s) => s.hanzi)), '天冷起来了。', '他最近胖起来了。', '一百多块钱', '九岁多', '这个菜好做，十分钟就做好了。', '下班以后马上下楼来', ''];
const align: Array<{ pieces: PatternPiece[]; hanzi: string; out: ReturnType<typeof alignPatternExample> }> = [];
for (const p of patterns) for (const h of sentences) if (chance(0.35)) align.push({ pieces: p.pieces, hanzi: h, out: alignPatternExample(p.pieces, h) });

// ---- small pure helpers
const pieceLists = patterns.map((p) => p.pieces);
const helpers = pieceLists.map((pieces) => ({
  pieces,
  tones: pieceTones(pieces),
  classes: pieces.map((p) => slotClass(p)),
  line: patternLine(pieces),
  name: patternName({ pieces }),
  edit: patternEditText(pieces),
  reparsed: parsePatternLine(patternEditText(pieces))?.pieces ?? null,
  merged: mergePieceDetails(parsePatternLine(patternEditText(pieces))?.pieces ?? [], pieces),
}));
const classes = ['Noun', 'MW', 'Adjective phrase', 'Whatever', 'v', 'Round number', 'constructor', 'toString', 'Single digit / Number', ''].map((slot) => ({
  slot, zh: pick(['', '名词', '量词', '个位数', 'nope']), out: '',
})).map((c) => ({ ...c, out: slotClass({ slot: c.slot, zh: c.zh }) }));
const blocks = [
  ...realNotes.map((n) => n.body ?? ''),
  'Common mistake\n✗ 二十个多学生\n✓ 二十多个学生\n\nJust a line.', '用法\n这是一个例子', 'Heading.\nnot a heading', '', '\n\n\n', '✘ wrong\n✔ right\n❌ x\n✅ y',
].map((text) => ({ text, out: noteTextBlocks(text) }));

writeFileSync(join(OUT, 'lesson-patterns.json'), JSON.stringify({ views, parse, align, helpers, classes, blocks }));
