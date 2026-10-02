/**
 * Calls round 4 PR 5 golden vectors: lesson materials (shared/materials/index.ts).
 * Writes materials.json; checked by core/…/MaterialsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MATERIAL_RENDER_WIDTH,
  MAX_MATERIAL_BYTES,
  MAX_MATERIAL_PAGES,
  MAX_MATERIAL_TITLE,
  MAX_PAGE_IMAGE_BYTES,
  MAX_PAGE_TEXT,
  PPTX_RENDER_NOTE,
  cleanMaterialTitle,
  cleanPageText,
  materialFileProblem,
  materialKindOf,
  materialTarget,
  materialText,
  parseMaterialTarget,
  sanitizePresented,
  titleFromFileName,
  turnPage,
} from '../../../shared/materials';

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
const r = rng(20261005);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const names = [
  'Lesson 5 – 把字句.pptx', 'slides.PDF', 'photo.JPG', 'pic.jpeg', 'a.webp', 'anim.gif', 'scan.png', 'old.ppt', 'talk.key', 'notes.docx',
  'noext', 'pdf', '.pdf', 'a.b.c.pdf', 'my_lesson__notes.pptx', '  spaced   name  .pdf', '___.pdf', '', '.', 'a.', 'x.PPTX', 'tab\there.png',
  'a.pdf\n', 'line\nbreak.pdf', '　全角　空格.pdf', 'emoji 😀.png', `${'长'.repeat(130)}.pdf`, `${'a'.repeat(119)}😀b.pdf`, 'a.b\n.c',
];
const mimes = [null, undefined, '', 'application/pdf', 'APPLICATION/PDF', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/png\n', 'text/plain', 'application/vnd.ms-powerpoint'];
const sizes = [0, -1, 1, 1024, 50 * 1024 * 1024, 50 * 1024 * 1024 + 1, 52.6 * 1024 * 1024, 120 * 1024 * 1024, NaN];
const kinds = [];
const problems = [];
for (const name of names) for (const mime of mimes) {
  kinds.push({ name, mime: mime ?? null, kind: materialKindOf(name, mime) });
  for (const size of sizes) problems.push({ name, mime: mime ?? null, size: Number.isNaN(size) ? 'NaN' : size, problem: materialFileProblem(name, mime, size) });
}
const titles = names.map((name) => ({ name, title: titleFromFileName(name) }));
const alphabet = ['a', 'B', ' ', '  ', '\n', '\r', '\t', '　', ' ', '\f', '\v', '好', '😀', '_', '.', 'pdf', ' ', '﻿'];
const rand = (n: number) => { let t = ''; for (let k = 0; k < n; k++) t += pick(alphabet); return t; };
for (let i = 0; i < 200; i++) { const name = rand(Math.floor(r() * 30)) + pick(['', '.pdf', '.png', '.PPTX', '.']); titles.push({ name, title: titleFromFileName(name) }); }

const rawTitles: unknown[] = [null, 5, true, '', '  ', ' Lesson 3 ', 'a\n\nb', 'x'.repeat(130), '把字句　复习'];
for (let i = 0; i < 100; i++) rawTitles.push(rand(Math.floor(r() * 140)));
const cleanTitles = rawTitles.map((raw) => ({ raw, title: cleanMaterialTitle(raw) }));

const rawTexts: unknown[] = [null, 7, '', '  a  b  ', 'a \n  b', 'a\n\n\n\nb', '  \n\n x \t\f y \n\n\n', 'x'.repeat(8100), '第一行\r\n第二行'];
for (let i = 0; i < 200; i++) rawTexts.push(rand(Math.floor(r() * 60)));
const pageTexts = rawTexts.map((raw) => ({ raw, text: cleanPageText(raw) }));

const textCases = [];
for (let i = 0; i < 40; i++) {
  const n = Math.floor(r() * 6);
  const pages = [];
  for (let k = 0; k < n; k++) pages.push({ page_index: Math.floor(r() * 10), text: pick([null, '', ' ', 'Hello', '你好\n世界', rand(10)]), notes: pick([null, '', 'Ask', rand(6)]) });
  const max = pick([200_000, 10, 30, 1]);
  textCases.push({ pages, max, text: materialText(pages, max) });
}

const targets = [];
for (const id of ['abc', 'A-b_9', 'x'.repeat(64), 'x'.repeat(65), 'bad id', '', '中']) for (const page of [0, 3, 9999, 10000]) targets.push({ id, page, target: materialTarget(id, page) });
const rawTargets: unknown[] = [null, 5, '', 'material:abc:0', 'material:abc:12', 'material:abc:-1', 'material:abc:12345', 'material:abc:1\n', 'material:a b:1', 'material::1', 'Material:abc:1', 'material:abc:1:2', `material:${'x'.repeat(64)}:3`, `material:${'x'.repeat(65)}:3`, 'material:abc:٣', 'material:abc:01'];
const parsed = rawTargets.map((raw) => ({ raw, parsed: parseMaterialTarget(raw) }));

const turns = [];
for (let i = 0; i < 300; i++) {
  const page = pick([0, 1, 2, 5, 9, 10, 299, -3, r() * 12, 2.5, 3.5, -0.5]);
  const delta = pick([0, 1, -1, 2, -5, 0.5, -0.5, 10]);
  const count = pick([0, -1, 1, 2, 3, 10, 300]);
  turns.push({ page, delta, count, result: turnPage(page, delta, count) });
}

const rawPresented: unknown[] = [
  null, 5, 'x', [], {},
  { material_id: 'm1', title: 'Lesson 5', page: 2, page_count: 5, by: 'u1', by_name: 'Minghui' },
  { material_id: 'm1', page: 9, page_count: 5 },
  { material_id: 'm1', page: -3, page_count: 5 },
  { material_id: 'm1', page: 1.5, page_count: 5 },
  { material_id: 'm1', page: 'x', page_count: 5 },
  { material_id: 'm1', page: '2', page_count: '4' },
  { material_id: 'm1', page: null, page_count: 3 },
  { material_id: 'm1', page: true, page_count: 3 },
  { material_id: 'm1', page: 1, page_count: 0 },
  { material_id: 'm1', page: 1, page_count: 301 },
  { material_id: 'm1', page: 1, page_count: 300 },
  { material_id: 'm1', page: 1, page_count: 2.5 },
  { material_id: 'bad id', page: 1, page_count: 2 },
  { material_id: 7, page: 1, page_count: 2 },
  { material_id: 'm1', page: 0, page_count: 2, title: 'x'.repeat(130), by: 5, by_name: 'n'.repeat(90) },
  { material_id: 'm1', page: 0, page_count: 2, title: 9 },
  { material_id: 'x'.repeat(64), page: 1e9, page_count: 7 },
];
const presented = rawPresented.map((raw) => ({ raw, presented: sanitizePresented(raw) }));

writeFileSync(
  join(OUT, 'materials.json'),
  JSON.stringify({
    constants: { MAX_MATERIAL_BYTES, MAX_PAGE_IMAGE_BYTES, MAX_MATERIAL_PAGES, MAX_MATERIAL_TITLE, MAX_PAGE_TEXT, MATERIAL_RENDER_WIDTH, PPTX_RENDER_NOTE },
    kinds, problems, titles, clean_titles: cleanTitles, page_texts: pageTexts, text_cases: textCases, targets, parsed, turns, presented,
  }),
);
