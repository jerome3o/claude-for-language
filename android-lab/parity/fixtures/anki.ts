/**
 * Golden vectors for package K (native Anki export): the web app's own
 * frontend/src/services/anki — hash.ts (cyrb53, stableId, guidFor, sha1Hex, fieldChecksum,
 * stripHtmlMedia), models.ts, sources.ts (deckToAnki / lessonToAnki / readerToAnki, htmlField,
 * isWordLike, cardProgress), naming.ts (apkgFilename, mediaFilename) and apkg.ts: the
 * collection.anki2 that buildCollection writes with sql.js, read back row by row. Writes
 * anki.json into process.argv[2]; core/…/anki/AnkiParityTest.kt asserts the Kotlin port
 * produces exactly the same ids, GUIDs, checksums, fields, model / deck JSON and card rows —
 * so a deck exported from either app updates the same notes in Anki.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { cyrb53, stableId, guidFor, sha1Hex, fieldChecksum, stripHtmlMedia } from '../../../frontend/src/services/anki/hash';
import { MODELS, CARD_TYPE_ORD } from '../../../frontend/src/services/anki/models';
import { deckToAnki, lessonToAnki, readerToAnki, htmlField, isWordLike, cardProgress, type DeckSourceCard, type DeckSourceNote, type ReaderSource, type AnkiSource } from '../../../frontend/src/services/anki/sources';
import { buildCollection, ankiDeckId, templateApplies, type ApkgInput, type AnkiNote } from '../../../frontend/src/services/anki/apkg';
import { apkgFilename, mediaFilename, mediaExtension } from '../../../frontend/src/services/anki/naming';
import { SAMPLE_LESSONS } from '../../../shared/lesson/samples';
import type { CustomLessonSpec } from '../../../shared/lesson';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: anki <out-dir>');
mkdirSync(OUT, { recursive: true });

// The repo root, to load sql.js (and its .wasm) from node_modules at run time — the bundler
// can't inline a WASM module, so it is required, not imported.
function findRoot(start: string): string | null {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'android-lab', 'parity'))) {
    if (dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
  return dir;
}
const root = findRoot(OUT) ?? findRoot(process.cwd());
if (!root) throw new Error(`repo root not found above ${OUT}`);
const requireFromRoot = createRequire(join(root, 'package.json'));
const initSqlJs = requireFromRoot('sql.js') as (config?: { locateFile?: (f: string) => string }) => Promise<any>;
const sqlDist = dirname(requireFromRoot.resolve('sql.js'));

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
const rand = rng(20260927);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const PIECES = ['你好', '咖啡', '一', '不', '我要一杯咖啡。', 'a', 'Z', ' ', '\n', '\r\n', '\t', '<b>', '</b>', '<img src="x.png">', '<IMG SRC=y>',
  '[sound:abc.mp3]', '&nbsp;', '&amp;', '&lt;', '&gt;', '&', '<', '>', '"', "'", '\\', '::', '·', '，', '。', '！', '？', '…', '😀', '𠀀',
  '\ud800', '\udc00', 'é', 'ǚ', 'Ω', '　', ' ', ' ', '0', '9', '123', '/', ':', '*', '?', '|', '-', '--', '_', '\u0000', '\u001f'];
// Text that ends up in SQLite: no lone surrogates or NULs (no real card has them, and SQLite
// libraries disagree on how to store them); the hash vectors keep them.
const STORED_PIECES = PIECES.filter(p => !/^[\ud800-\udfff]$/.test(p) && p !== '\u0000');
function randomText(max = 8, stored = false): string {
  let s = '';
  const n = int(0, max);
  for (let i = 0; i < n; i++) s += pick(stored ? STORED_PIECES : PIECES);
  return s;
}

// ---- hashes ----
const hashInputs: string[] = ['', 'a', '你好', 'note|n1', 'chinese-learning-app:model::汉语学习 Vocabulary', '😀', '\ud800', '\udc00x'];
for (let i = 0; i < 400; i++) hashInputs.push(randomText(12));
const seeds = [0, 0x9e3779b9, 0x7f4a7c15, 1, 12345, -1];
const cyrb = hashInputs.flatMap(s => seeds.map(seed => [s, seed, cyrb53(s, seed)]));
const stable = hashInputs.slice(0, 200).map(s => ['chinese-learning-app:deck', s, stableId('chinese-learning-app:deck', s)]);
const guids: Array<[string[], string]> = [];
for (let i = 0; i < 300; i++) {
  const parts = Array.from({ length: int(1, 4) }, () => randomText(5));
  guids.push([parts, guidFor(...parts)]);
}
guids.push([['note', 'n1'], guidFor('note', 'n1')], [['reader-page', 'r1', '1'], guidFor('reader-page', 'r1', '1')]);
const sha1Strings = hashInputs.map(s => [s, sha1Hex(s)]);
// Byte arrays across the SHA-1 block boundaries (55, 56, 63, 64, 119, 120 …).
const sha1Bytes: Array<[number[], string]> = [];
for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 200, 1000, 4097]) {
  const bytes = Uint8Array.from({ length: len }, () => int(0, 255));
  sha1Bytes.push([Array.from(bytes), sha1Hex(bytes)]);
}
const checksums = hashInputs.map(s => [s, fieldChecksum(s)]);
const strips = hashInputs.map(s => [s, stripHtmlMedia(s)]);
const htmls: Array<[string | null, string]> = [[null, htmlField(null)], ['', htmlField('')]];
for (const s of hashInputs) htmls.push([s, htmlField(s)]);
const wordLike = [...hashInputs, '你好', '一路平安', '你好吗？', '我今天很累', '热的', 'a b', '一二三四', '一二三四五', '😀😀'].map(s => [s, isWordLike(s)]);

// ---- names ----
const titles = ['Readers::小猫的一天', 'HSK 1 · Greetings', '  ', 'a/b:c*d', '小猫', 'Lessons::The 把 sentence', '', 'Café au lait', 'ǚ ü', '重庆 trip 2026',
  'a'.repeat(80), '一'.repeat(40), '---x---', 'Hello::::World', '😀 emoji', '㐀䶵 rare', '𠀀 wide', '"quoted"', 'tab\there'];
for (let i = 0; i < 150; i++) titles.push(randomText(10));
const filenames = titles.map(t => [t, apkgFilename(t)]);
const mimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4', 'AUDIO/MPEG', '', 'application/octet-stream', 'video/mp4'];
const mediaNames = sha1Bytes.flatMap(([bytes], i) => [[bytes, mimeTypes[i % mimeTypes.length], mediaFilename(Uint8Array.from(bytes), mimeTypes[i % mimeTypes.length])]]);
const extensions = mimeTypes.map(t => [t, mediaExtension(t)]);

// ---- sources ----
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const deckNotes: DeckSourceNote[] = [
  {
    id: 'n1', hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', fun_facts: 'Greeting\n你 (nǐ) you', context: 'At the door',
    sentence_clue: '你好吗？', sentence_clue_pinyin: 'nǐ hǎo ma', sentence_clue_translation: 'How are you?',
    audio_url: 'generated/n1.mp3', sentence_clue_audio_url: 'generated/n1-clue.mp3',
  },
  { id: 'n2', hanzi: '谢谢', pinyin: 'xiè xie', english: 'thanks & <more>', audio_url: null, sentence_clue: null, sentence_clue_audio_url: 'orphan.mp3' },
  { id: 'n3', hanzi: '  ', pinyin: '', english: 'blank — skipped' },
  { id: 'n4', hanzi: ' 再见 ', pinyin: 'zàijiàn', english: 'bye', fun_facts: null, context: 'ctx only', sentence_clue: '明天见。', audio_url: '/api/audio/generated/n4.mp3' },
];
const deckCards: DeckSourceCard[] = [
  { note_id: 'n1', card_type: 'hanzi_to_meaning', queue: 2, interval: 20, ease_factor: 2.3, repetitions: 6, lapses: 1, next_review_at: new Date(NOW + 5 * 86_400_000 + 3_600_000).toISOString() },
  { note_id: 'n1', card_type: 'meaning_to_hanzi', queue: 1, interval: 0, ease_factor: 250, repetitions: 1, lapses: 0, next_review_at: null },
  { note_id: 'n1', card_type: 'audio_to_hanzi', queue: 0, interval: 0, ease_factor: 2.5, repetitions: 0, lapses: 0, next_review_at: null },
  { note_id: 'n2', card_type: 'hanzi_to_meaning', queue: 3, interval: 1.4, ease_factor: 1.3, repetitions: 3, lapses: 2, next_review_at: new Date(NOW - 2.5 * 86_400_000).toISOString() },
  { note_id: 'n2', card_type: 'meaning_to_hanzi', queue: 2, interval: 0.4, ease_factor: 0, repetitions: 2, lapses: 0, next_review_at: 'garbage' },
  { note_id: 'n4', card_type: 'audio_to_hanzi', queue: 2, interval: 100, ease_factor: 3.1, repetitions: 9, lapses: 0, next_review_at: new Date(NOW + 99.5 * 86_400_000).toISOString() },
];
// Random decks: every field shape the adapter looks at.
const randomDecks: Array<{ name: string; description: string | null; notes: DeckSourceNote[]; cards: DeckSourceCard[] }> = [];
const cardTypes = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;
for (let d = 0; d < 12; d++) {
  const notes: DeckSourceNote[] = [];
  const cards: DeckSourceCard[] = [];
  for (let i = 0; i < int(0, 12); i++) {
    const id = `d${d}n${i}`;
    const maybe = () => (rand() < 0.3 ? null : rand() < 0.2 ? '' : randomText(6, true));
    notes.push({
      id, hanzi: rand() < 0.1 ? ' ' : randomText(4, true) || '字', pinyin: randomText(4, true), english: randomText(5, true),
      fun_facts: maybe(), context: maybe(), sentence_clue: maybe(), sentence_clue_pinyin: maybe(), sentence_clue_translation: maybe(),
      audio_url: rand() < 0.5 ? `generated/${id}.mp3` : null, sentence_clue_audio_url: rand() < 0.5 ? `generated/${id}-c.mp3` : null,
    });
    for (const ct of cardTypes) {
      if (rand() < 0.2) continue;
      cards.push({
        note_id: id, card_type: ct, queue: int(0, 3), interval: rand() < 0.5 ? int(0, 400) : rand() * 30,
        ease_factor: pick([0, 1.3, 2.5, 2.37, 250, 130, 310, 10, 11]), repetitions: int(0, 20), lapses: int(0, 5),
        next_review_at: rand() < 0.2 ? null : new Date(NOW + (rand() - 0.3) * 60 * 86_400_000).toISOString(),
      });
    }
  }
  randomDecks.push({ name: randomText(6, true) || 'Deck', description: rand() < 0.5 ? null : randomText(5, true), notes, cards });
}
const deckCases = [
  { deck: { name: 'HSK 1', description: 'Basics' }, notes: deckNotes, cards: deckCards },
  ...randomDecks.map(d => ({ deck: { name: d.name, description: d.description }, notes: d.notes, cards: d.cards })),
].flatMap(c => [false, true].map(progress => ({
  deck: c.deck, notes: c.notes, cards: c.cards, progress, now: NOW,
  source: deckToAnki(c.deck, c.notes, c.cards, { progress, now: NOW }),
})));
const progressCases = deckCards.concat(randomDecks.flatMap(d => d.cards)).map(card => ({ card, now: NOW, progress: cardProgress(card, NOW) }));

const handLesson: CustomLessonSpec = {
  title: 'Ordering coffee',
  description: 'Cafe basics',
  sections: [
    {
      title: 'Words',
      exercises: [
        { type: 'match', pairs: [{ hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee' }, { hanzi: '一杯', pinyin: 'yì bēi', english: 'one cup' }] },
        { type: 'note', title: 'Note', sentences: [{ hanzi: '我要一杯咖啡。', pinyin: 'wǒ yào yì bēi kāfēi', english: 'I want a cup of coffee.' }, { hanzi: '咖啡', english: 'dup — ignored' }] },
      ],
    },
    {
      exercises: [
        { type: 'translate', english: 'Two coffees please', reference_hanzi: '请给我两杯咖啡', reference_pinyin: 'qǐng gěi wǒ liǎng bēi kāfēi' },
        { type: 'choice', question: 'Hot?', options: [{ hanzi: '热的', english: 'hot' }, { hanzi: '冰的', english: 'iced' }], correct: 1 },
        { type: 'choice', question: 'Out of range', options: [{ hanzi: '热的', english: 'hot' }], correct: 5 },
        { type: 'scramble', english: 'I want coffee', tiles: ['我', '要', '咖啡'], correct_order: ['我', '要', '咖啡'] },
        { type: 'listen_choice', audio: { hanzi: '有', pinyin: 'yǒu', english: 'have' }, options: [{ hanzi: '有' }, { hanzi: '又' }], correct: 0 },
        { type: 'listen_translate', audio: { hanzi: '我要一杯咖啡。', english: 'dup' } },
        { type: 'speak', prompt: 'Order', example: { hanzi: '一杯冰咖啡，谢谢。', english: 'One iced coffee, thanks.' } },
        { type: 'speak', prompt: 'No example' },
        { type: 'describe_image', image_prompt: 'a cafe', reference_hanzi: '他在喝咖啡。', reference_english: 'He is drinking coffee.' },
        { type: 'note', title: 'No sentences', body: 'text' },
        { type: 'sentence_making', words: [{ hanzi: '因为', pinyin: 'yīnwèi', english: 'because' }, { hanzi: ' 所以 ' }], example: { hanzi: '因为下雨，所以我不去。', english: 'Because it rains I stay.' } },
        { type: 'write_typed', answer: { hanzi: '学习', pinyin: 'xuéxí', english: 'study' } },
        { type: 'write_handwriting', answer: { hanzi: '今天天气很好', english: 'Nice weather today' } },
        { type: 'dictation', audio: { hanzi: '明天见', pinyin: 'míngtiān jiàn' } },
        { type: 'oral_expression', prompt: 'Talk', hints: [{ hanzi: '周末', english: 'weekend' }], example: { hanzi: '周末我去爬山。', english: 'I hike at weekends.' } },
        { type: 'oral_expression', prompt: 'Bare' },
        {
          type: 'conversation', situation: 'cafe', speakers: [{ name: 'A' }, { name: 'B' }],
          lines: [{ speaker: 0, hanzi: '你要什么？', pinyin: 'nǐ yào shénme', english: 'What would you like?' }, { speaker: 1, hanzi: '咖啡', english: 'Coffee (dup)' }, { speaker: 0, hanzi: '好的', english: 'OK' }],
          questions: [{ question: 'What?', answer: 'coffee' }],
        },
      ],
    },
  ],
} as unknown as CustomLessonSpec;
const lessonSpecs: Array<{ spec: CustomLessonSpec; sourceId?: string }> = [
  { spec: handLesson, sourceId: 'L1' },
  { spec: handLesson },
  { spec: { title: '   ', sections: [] } as CustomLessonSpec, sourceId: 'empty' },
  ...SAMPLE_LESSONS.map(s => ({ spec: s.spec, sourceId: `sample-${s.id}` })),
];
const lessonCases = lessonSpecs.map(({ spec, sourceId }) => ({ spec, sourceId: sourceId ?? null, source: lessonToAnki(spec, { sourceId }) }));

const readers: ReaderSource[] = [
  {
    id: 'r1', title_chinese: '小猫的一天', title_english: "A cat's day",
    pages: [
      { id: 'p2', page_number: 2, content_chinese: '它去公园玩。', content_pinyin: 'tā qù gōngyuán wán', content_english: 'It goes to the park.' },
      { id: 'p1', page_number: 1, content_chinese: '小猫早上起床。', content_pinyin: 'xiǎo māo zǎoshang qǐchuáng', content_english: 'The kitten gets up in the morning.' },
      { id: 'p3', page_number: 3, content_chinese: '小猫早上起床。', content_pinyin: 'dup', content_english: 'dup page' },
      { id: 'p4', page_number: 4, content_chinese: '  ', content_pinyin: '', content_english: 'blank' },
    ],
    vocabulary_used: [{ hanzi: '公园', pinyin: 'gōngyuán', english: 'park' }, { hanzi: '公园', pinyin: 'x', english: 'dup' }, { hanzi: '它去公园玩。', pinyin: '', english: 'same as a page' }],
  },
  { id: 'r2', title_chinese: '  ', title_english: ' English only ', pages: [] },
  { id: 'r3', title_chinese: '', title_english: '', pages: [{ id: 'q', page_number: 1, content_chinese: '好', content_pinyin: 'hǎo', content_english: 'good' }] },
];
const readerCases = readers.map(reader => ({ reader, source: readerToAnki(reader) }));

// ---- collections (collection.anki2 rows written by sql.js) ----
function toApkgInput(src: AnkiSource, audioFill: boolean): ApkgInput {
  const notes: AnkiNote[] = src.notes.map(n => {
    const fields = { ...n.fields };
    if (audioFill) for (const f of ['Audio', 'SentenceAudio'] as const) if (n.audio?.[f]) fields[f] = `[sound:${sha1Hex(f + n.guid).slice(0, 20)}.mp3]`;
    return { model: n.model, guid: n.guid, fields, tags: n.tags, progress: n.progress };
  });
  return { deckName: src.deckName, deckDescription: src.description, notes, media: [] };
}
const collectionInputs: Array<{ input: ApkgInput; now: number }> = [
  { input: { deckName: 'Empty', notes: [], media: [] }, now: NOW },
  {
    input: {
      deckName: 'Hand made', deckDescription: 'with "quotes" & <tags>\n',
      notes: [
        { model: 'vocabulary', guid: 'g1', fields: { Hanzi: '<b>你好</b>', English: 'hello', Audio: '[sound:a.mp3]' }, tags: ['a tag', 'x\ty', 'plain'] },
        { model: 'vocabulary', guid: 'g1', fields: { Hanzi: 'duplicate guid — skipped' } },
        { model: 'vocabulary', guid: 'g2', fields: { Hanzi: '', English: 'no hanzi' }, tags: [] },
        { model: 'vocabulary', guid: 'g3', fields: { Hanzi: '123', English: '' }, progress: { 0: { state: 'review', intervalDays: 0.4, ease: 1.1, reps: 3, lapses: 1, dueInDays: -2.5 } } },
        { model: 'sentence', guid: 'g4', fields: { Chinese: '我要一杯咖啡。', Audio: '' }, progress: { 0: { state: 'learning', intervalDays: 2.5, ease: 2.5, reps: 1, lapses: 0, dueInDays: 7 } } },
        { model: 'sentence', guid: 'g5', fields: { Chinese: '[sound:only.mp3]' } },
        { model: 'vocabulary', guid: 'g6', fields: { Hanzi: '&nbsp;', English: 'x', Audio: '<img src=a>' }, progress: { 1: { state: 'new', intervalDays: 0, ease: 2.5, reps: 4, lapses: 2, dueInDays: 0 } } },
      ],
      media: [],
    },
    now: Date.UTC(2026, 0, 1, 0, 0, 0) + 123,
  },
  { input: { deckName: 'Sentences only', notes: [{ model: 'sentence', guid: 's1', fields: { Chinese: '好' } }], media: [] }, now: NOW + 86_399_999 },
];
for (const c of deckCases) collectionInputs.push({ input: toApkgInput(c.source, c.progress), now: NOW + 7 });
for (const c of lessonCases.slice(0, 4)) collectionInputs.push({ input: toApkgInput(c.source, true), now: NOW });
for (const c of readerCases) collectionInputs.push({ input: toApkgInput(c.source, false), now: NOW });

const SQL = await initSqlJs({ locateFile: (f: string) => join(sqlDist, f) });
function rows(bytes: Uint8Array, table: string): unknown[][] {
  const db = new SQL.Database(bytes);
  try {
    const res = db.exec(`SELECT * FROM ${table} ORDER BY rowid`);
    return res.length ? res[0].values : [];
  } finally {
    db.close();
  }
}
function typedRows(bytes: Uint8Array, table: string): string[][] {
  const db = new SQL.Database(bytes);
  try {
    const cols = db.exec(`SELECT * FROM ${table} LIMIT 0`);
    const names: string[] = db.exec(`PRAGMA table_info(${table})`)[0].values.map((r: unknown[]) => String(r[1]));
    void cols;
    const res = db.exec(`SELECT ${names.map(n => `typeof(${n})`).join(',')} FROM ${table} ORDER BY rowid`);
    return res.length ? res[0].values.map((r: unknown[]) => r.map(String)) : [];
  } finally {
    db.close();
  }
}
const collections = collectionInputs.map(({ input, now }) => {
  const built = buildCollection(input, { sql: SQL, now });
  return {
    input, now,
    noteCount: built.noteCount, cardCount: built.cardCount, deckId: built.deckId,
    col: rows(built.bytes, 'col'), notes: rows(built.bytes, 'notes'), cards: rows(built.bytes, 'cards'),
    colTypes: typedRows(built.bytes, 'col'), noteTypes: typedRows(built.bytes, 'notes'), cardTypes: typedRows(built.bytes, 'cards'),
  };
});

const templateCases: Array<[string, number, Record<string, string>, boolean]> = [];
for (let i = 0; i < 200; i++) {
  const model = pick(['vocabulary', 'sentence'] as const);
  const m = MODELS[model];
  const fields: Record<string, string> = {};
  for (const f of m.fields) if (rand() < 0.6) fields[f] = pick(['', ' ', 'x', '<b></b>', '[sound:a.mp3]', '&nbsp;', '<img src=a>', '你']);
  const ord = int(0, m.templates.length - 1);
  templateCases.push([model, ord, fields, templateApplies(m, ord, fields)]);
}

writeFileSync(join(OUT, 'anki.json'), JSON.stringify({
  hash: { cyrb, stable, guids, sha1Strings, sha1Bytes, checksums, strips, htmls, wordLike },
  models: MODELS,
  cardTypeOrd: CARD_TYPE_ORD,
  deckIds: titles.slice(0, 60).map(t => [t, ankiDeckId(t)]),
  filenames, mediaNames, extensions,
  progressCases, deckCases, lessonCases, readerCases,
  templateCases,
  collections,
}));
