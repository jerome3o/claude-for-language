/**
 * Golden vectors for package G (lesson library / editors): the web's own
 * shared/lesson validate / diff / export and shared/reader validate / diff /
 * export run over the bundled sample lessons plus thousands of seeded
 * mutations, so the Kotlin ports in core/…/spec/ are provably identical.
 * Also writes the registry + samples + blank exercises (`lesson-catalogue.json`),
 * which must equal core/src/main/resources/lesson/catalogue.json.
 *
 * Output (into process.argv[2]): lesson-catalogue.json, lesson-spec.json, reader-spec.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateLessonSpec } from '../../../shared/lesson/validate';
import { diffLessonSpecs, formatLessonDiff, exercisePrimaryText, canonicalJson } from '../../../shared/lesson/diff';
import { lessonToMarkdown, lessonToJson, lessonToCsv, lessonExportFilename } from '../../../shared/lesson/export';
import { EXERCISE_TYPE_LIST, SKILL_LABELS } from '../../../shared/lesson/registry';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import { defaultExercise } from '../../../shared/lesson/defaults';
import { validateReaderSpec } from '../../../shared/reader/validate';
import { diffReaderSpecs, formatReaderDiff } from '../../../shared/reader/diff';
import { readerToMarkdown, readerToJson, readerToCsv, readerExportFilename } from '../../../shared/reader/export';
import type { CustomLessonSpec, ExerciseType } from '../../../shared/lesson/types';

const out = process.argv[2];
mkdirSync(out, { recursive: true });

// ---------------- seeded RNG ----------------
let seed = 0x9e3779b9;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------------- catalogue ----------------
const catalogue = {
  skills: SKILL_LABELS,
  types: EXERCISE_TYPE_LIST,
  samples: SAMPLE_LESSONS,
  defaults: Object.fromEntries(EXERCISE_TYPE_LIST.map(t => [t.type, defaultExercise(t.type as ExerciseType)])),
};
writeFileSync(join(out, 'lesson-catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');

// ---------------- value pools ----------------
const STRINGS = [
  '', ' ', '  　 ', '你好', '我要一杯咖啡。', 'nǐ hǎo', 'Hello', 'a,b', 'say "hi"', 'line\nbreak', 'tab\there',
  '把门关上', '有', '又', '🎓', '📖📖📖📖📖', '﻿ 空白  ', '一二三四五六七八九十一二三', '长春的冬天很冷。他穿上红色的大衣，走在雪里。',
  'x'.repeat(201), 'A/B:C*D?"E<F>G|H', '  leading and trailing  ', '-dash-', '中文\r\nCRLF', 'ctrl\u0001char', 'lone\uD800surrogate',
];
const WEIRD: unknown[] = [null, 0, 1, -1, 1.5, 2, 99, true, false, [], {}, ['a'], { hanzi: '你' }, 'type', 'handwrite', 'female', 'male', 'audio'];

function randomValue(): unknown {
  return chance(0.6) ? pick(STRINGS) : pick(WEIRD);
}

// Mutate one path inside a JSON value (any depth), for validator coverage.
function mutateAnywhere(root: any): void {
  const paths: Array<{ parent: any; key: string | number }> = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach((x, i) => { paths.push({ parent: v, key: i }); walk(x); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => { paths.push({ parent: v, key: k }); walk(v[k]); });
  };
  walk(root);
  if (paths.length === 0) return;
  const { parent, key } = pick(paths);
  const r = rand();
  if (r < 0.3) {
    if (Array.isArray(parent)) parent.splice(key as number, 1); else delete parent[key];
  } else if (r < 0.8) {
    parent[key] = clone(randomValue());
  } else if (Array.isArray(parent)) {
    parent.push(clone(parent[key as number]));
  } else {
    parent[pick(['type', 'hanzi', 'english', 'pinyin', 'options', 'correct', 'cues', 'input', 'extra'])] = clone(randomValue());
  }
}

// A type-preserving edit (keeps the spec renderable by diff / export).
function editText(s: string): string {
  const r = rand();
  if (r < 0.3) return s + pick(['。', '吗？', ' again', '了']);
  if (r < 0.5) return s.slice(0, Math.max(0, s.length - 1));
  if (r < 0.7) return pick(STRINGS.filter(x => typeof x === 'string' && !x.includes('\uD800')));
  return s.split('').reverse().join('');
}

function editStrings(v: any, p: number): any {
  if (typeof v === 'string') return chance(p) ? editText(v) : v;
  if (Array.isArray(v)) return v.map(x => editStrings(x, p));
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = k === 'type' ? v[k] : editStrings(v[k], p);
    return o;
  }
  return v;
}

const allExercises = (): any[] => SAMPLE_LESSONS.flatMap(s => s.spec.sections.flatMap(sec => sec.exercises));

function structuralEdit(spec: any): any {
  const s = clone(spec);
  const ops = 1 + Math.floor(rand() * 4);
  for (let k = 0; k < ops; k++) {
    const r = rand();
    const sec = pick(s.sections) as any;
    if (r < 0.15) s.title = editText(s.title);
    else if (r < 0.22) { if (chance(0.5)) s.icon = pick(['🎓', '📖', '💬', '']); else delete s.icon; }
    else if (r < 0.28) s.description = chance(0.3) ? undefined : editText(s.description ?? 'About this lesson');
    else if (r < 0.36) sec.title = chance(0.3) ? undefined : pick(['Warm-up', 'Practice', '  ', 'Your turn', sec.title ?? 'New']);
    else if (r < 0.46) sec.exercises.push(clone(pick(allExercises())));
    else if (r < 0.54 && sec.exercises.length > 0) sec.exercises.splice(Math.floor(rand() * sec.exercises.length), 1);
    else if (r < 0.64 && sec.exercises.length > 1) { const i = Math.floor(rand() * sec.exercises.length); const [x] = sec.exercises.splice(i, 1); sec.exercises.splice(Math.floor(rand() * sec.exercises.length), 0, x); }
    else if (r < 0.72) { const other = pick(s.sections) as any; if (sec.exercises.length) other.exercises.push(sec.exercises.shift()); }
    else if (r < 0.78) s.sections.push({ title: chance(0.5) ? 'Extra' : undefined, exercises: [clone(pick(allExercises()))] });
    else if (r < 0.82 && s.sections.length > 1) s.sections.splice(Math.floor(rand() * s.sections.length), 1);
    else if (sec.exercises.length) {
      const i = Math.floor(rand() * sec.exercises.length);
      sec.exercises[i] = editStrings(sec.exercises[i], 0.35);
      if (chance(0.2) && sec.exercises[i].type === 'describe_image') sec.exercises[i].image_url = chance(0.5) ? 'images/abc.png' : null;
    }
  }
  return JSON.parse(JSON.stringify(s));
}

// ---------------- lesson cases ----------------
const lessonValidate: Array<{ spec: unknown; errors: string[] }> = [];
const addValidate = (spec: unknown) => lessonValidate.push({ spec, errors: validateLessonSpec(spec) });

for (const sample of SAMPLE_LESSONS) addValidate(sample.spec);
for (const d of Object.values(catalogue.defaults)) addValidate({ title: 'T', sections: [{ exercises: [d] }] });
for (const v of [null, 1, 'x', [], {}, { title: 'x' }, { title: 'x', sections: [] }, { title: 'x', sections: [{}] }, { title: 'x', sections: [{ exercises: [] }] }, { title: 'x', sections: [[1]] }, { title: 'x', icon: 5, sections: [{ exercises: [1, null, 'a', { type: 7 }, { type: 'nope' }, { }] }] }]) addValidate(v);
addValidate({ title: 'Many', sections: Array.from({ length: 21 }, () => ({ exercises: [{ type: 'note', body: 'b' }, { type: 'note', body: 'b' }, { type: 'note', body: 'b' }] })) });
for (let i = 0; i < 2500; i++) {
  const spec = clone(pick(SAMPLE_LESSONS).spec) as any;
  if (chance(0.5)) spec.sections.push(...clone(pick(SAMPLE_LESSONS).spec.sections));
  const n = 1 + Math.floor(rand() * 5);
  for (let k = 0; k < n; k++) mutateAnywhere(spec);
  addValidate(JSON.parse(JSON.stringify(spec)));
}

const lessonDiff: Array<{ before: unknown; after: unknown; lines: string[]; summary: unknown }> = [];
const summarise = (d: ReturnType<typeof diffLessonSpecs>) => ({
  changed: d.changed,
  meta: d.meta.map(m => [m.field, m.before ?? null, m.after ?? null]),
  sections: d.sections.map(s => s.kind === 'renamed' ? [s.kind, s.index, s.before, s.after] : [s.kind, s.index, s.title, s.exerciseCount]),
  exercises: d.exercises.map(e => e.kind === 'moved'
    ? [e.kind, e.section, e.index, e.fromSection, e.fromIndex]
    : e.kind === 'changed'
      ? [e.kind, e.section, e.index, e.fields.map(f => [f.field, canonicalJson(f.before) ?? null, canonicalJson(f.after) ?? null])]
      : [e.kind, e.section, e.index]),
});
const pushLessonDiff = (before: CustomLessonSpec, after: CustomLessonSpec) => {
  try {
    const d = diffLessonSpecs(before, after);
    lessonDiff.push({ before, after, lines: formatLessonDiff(d), summary: summarise(d) });
  } catch { /* shapes the TS can't diff aren't vectors */ }
};
for (const a of SAMPLE_LESSONS) for (const b of SAMPLE_LESSONS) if (chance(0.25)) pushLessonDiff(a.spec, b.spec);
for (let i = 0; i < 1500; i++) {
  const base = structuralEdit(pick(SAMPLE_LESSONS).spec);
  pushLessonDiff(base, chance(0.1) ? clone(base) : structuralEdit(base));
}

const primary: Array<{ exercise: unknown; text: string }> = [];
for (const ex of allExercises()) primary.push({ exercise: ex, text: exercisePrimaryText(ex) });
for (let i = 0; i < 300; i++) {
  const ex = editStrings(clone(pick(allExercises())), 0.5);
  try { primary.push({ exercise: ex, text: exercisePrimaryText(ex) }); } catch { /* skip */ }
}

const lessonExport: Array<{ spec: unknown; md: string; json: string; csv: string; filename: string }> = [];
const pushExport = (spec: any) => {
  try {
    lessonExport.push({ spec, md: lessonToMarkdown(spec), json: lessonToJson(spec), csv: lessonToCsv(spec), filename: lessonExportFilename(spec, pick(['md', 'json', 'csv'])) });
  } catch { /* skip */ }
};
for (const s of SAMPLE_LESSONS) pushExport(s.spec);
for (let i = 0; i < 800; i++) pushExport(structuralEdit(pick(SAMPLE_LESSONS).spec));

writeFileSync(join(out, 'lesson-spec.json'), JSON.stringify({ validate: lessonValidate, diff: lessonDiff, primary, export: lessonExport }));

// ---------------- readers ----------------
const PAGES = [
  '长春的冬天很冷。', '小明穿上红色的大衣。', '他走在雪里，很开心。', '“你好！”妈妈说。', '他们一起回家了。', '小明在巴黎',
  '今天刮风了，天气不好。', '他喝了一杯热茶', '猫在窗户旁边睡觉。', '晚上，他们吃饺子。',
];
function randomPage(i: number): any {
  const p: any = {};
  if (chance(0.7)) p.id = `page-${i}-${Math.floor(rand() * 5)}`;
  p.content_chinese = pick(PAGES);
  p.content_pinyin = chance(0.7) ? pick(['Chángchūn de dōngtiān hěn lěng.', '', ' nǐ hǎo ']) : undefined;
  p.content_english = pick(['Winter is cold.', 'He is happy.', '', '  ', 'They went home.']);
  if (chance(0.7)) p.image_prompt = chance(0.2) ? null : pick(['A boy in a red coat', '', '  snow  ', 'A cat by the window']);
  if (chance(0.3)) p.image_url = chance(0.5) ? 'images/x.png' : null;
  return JSON.parse(JSON.stringify(p));
}
function randomReader(): any {
  const r: any = {
    title_chinese: pick(['长春的冬天', '', '小猫', ' 新故事 ']),
    title_english: pick(['Winter in Changchun', 'The cat', '', 'A/B: "story"?']),
    difficulty_level: pick(['beginner', 'elementary', 'intermediate', 'advanced', 'expert']),
  };
  if (chance(0.7)) r.topic = pick([null, 'winter', '  ', 'daily life']);
  if (chance(0.6)) r.vocabulary_used = Array.from({ length: Math.floor(rand() * 5) }, () => ({ hanzi: pick(['冬天', '冷', ' ', '冬天', '雪']), pinyin: pick(['dōngtiān', '', ' lěng ']), english: pick(['winter', 'cold', '']) }));
  r.pages = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => randomPage(i));
  return r;
}
function editReader(spec: any): any {
  const s = clone(spec);
  const ops = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < ops; k++) {
    const r = rand();
    if (r < 0.1) s.title_chinese = editText(s.title_chinese);
    else if (r < 0.15) s.difficulty_level = pick(['beginner', 'advanced']);
    else if (r < 0.2) s.topic = pick([null, 'food', undefined]);
    else if (r < 0.35) s.pages.push(randomPage(s.pages.length + 7));
    else if (r < 0.5 && s.pages.length > 1) s.pages.splice(Math.floor(rand() * s.pages.length), 1);
    else if (r < 0.65 && s.pages.length > 1) { const [x] = s.pages.splice(Math.floor(rand() * s.pages.length), 1); s.pages.splice(Math.floor(rand() * s.pages.length), 0, x); }
    else if (s.pages.length) {
      const p = pick(s.pages) as any;
      const f = pick(['content_chinese', 'content_pinyin', 'content_english', 'image_prompt', 'id']);
      if (f === 'id') delete p.id; else p[f] = editText(p[f] ?? '');
    }
  }
  return JSON.parse(JSON.stringify(s));
}

const readerValidate: Array<{ spec: unknown; errors: string[] }> = [];
for (const v of [null, 1, [], {}, { pages: {} }, { title_chinese: 'x', title_english: 'y', difficulty_level: 'beginner', pages: [] }, { title_chinese: 'x', title_english: 'y', difficulty_level: 'beginner', topic: 3, vocabulary_used: 'no', pages: [1, { id: '' }, { id: 5 }, { id: 'a', content_chinese: 'x'.repeat(4001), content_english: 'e' }, { id: 'a', content_chinese: '你', content_pinyin: 1, content_english: 2, image_prompt: 3 }] }]) {
  readerValidate.push({ spec: v, errors: validateReaderSpec(v) });
}
for (let i = 0; i < 1500; i++) {
  const spec = randomReader();
  if (chance(0.4)) { const n = 1 + Math.floor(rand() * 3); for (let k = 0; k < n; k++) mutateAnywhere(spec); }
  if (chance(0.05)) spec.pages = Array.from({ length: 61 }, (_, j) => randomPage(j));
  const json = JSON.parse(JSON.stringify(spec));
  readerValidate.push({ spec: json, errors: validateReaderSpec(json) });
}

const readerDiff: Array<{ before: unknown; after: unknown; lines: string[]; summary: unknown }> = [];
for (let i = 0; i < 1500; i++) {
  const before = randomReader();
  const after = chance(0.1) ? clone(before) : editReader(before);
  try {
    const d = diffReaderSpecs(before, after);
    readerDiff.push({
      before, after, lines: formatReaderDiff(d),
      summary: {
        changed: d.changed,
        meta: d.meta.map(m => [m.field, m.before ?? null, m.after ?? null]),
        pages: d.pages.map(p => p.kind === 'changed' ? [p.kind, p.index, p.fromIndex, p.fields.map(f => [f.field, f.before ?? null, f.after ?? null])] : p.kind === 'moved' ? [p.kind, p.index, p.fromIndex] : [p.kind, p.index]),
      },
    });
  } catch { /* skip */ }
}

const readerExport: Array<{ spec: unknown; md: string; json: string; csv: string; filename: string }> = [];
for (let i = 0; i < 600; i++) {
  const spec = randomReader();
  try {
    readerExport.push({ spec, md: readerToMarkdown(spec), json: readerToJson(spec), csv: readerToCsv(spec), filename: readerExportFilename(spec, pick(['md', 'json', 'csv'])) });
  } catch { /* skip */ }
}

writeFileSync(join(out, 'reader-spec.json'), JSON.stringify({ validate: readerValidate, diff: readerDiff, export: readerExport }));
