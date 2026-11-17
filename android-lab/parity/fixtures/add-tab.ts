/**
 * The ＋ Add tab (shared/add/add.ts): content tiles, result lines, the word input's kind, and photo →
 * OCR — the Chinese of a read line, box clean-up, line scores and order, hand-picked spans, resize.
 * Writes add-tab.json; checked by core/…/add/AddTabParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADD_AUDIO_FORMATS,
  ADD_CONTENT_TILES,
  addContentLang,
  addContentPlaceholder,
  addContentReady,
  addResultLine,
  classifyWordInput,
  cleanOcrBox,
  ocrChineseText,
  ocrFoundLine,
  ocrLineScore,
  ocrResizeDims,
  ocrSpan,
  orderOcrLines,
  type OcrLine,
} from '../../../shared/add/add';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const kinds = [...ADD_CONTENT_TILES.map((t) => t.kind), 'nope'];
const formats = ADD_AUDIO_FORMATS.map((f) => f.format);
const texts = ['', ' ', 'a', '猫', '猫咪', 'cafe', 'ordering coffee', '我今天去了公园。', '你好吗', '  银行  ', 'yínháng', 'bank 银行', '𠀀𠀁', '１２３'];

const contentCases = kinds.flatMap((kind) =>
  formats.flatMap((format) =>
    texts.map((text) => ({
      kind,
      format,
      text,
      placeholder: addContentPlaceholder(kind as never, format),
      lang: addContentLang(kind as never, format),
      ready: addContentReady(kind as never, text, format),
    })),
  ),
);

const results = kinds.flatMap((kind) => (['making', 'ready', 'failed'] as const).map((status) => ({ kind, status, line: addResultLine(kind as never, status) })));

const lineTexts = [
  '太体面了',
  'Google Chrome - 太 体 面 了',
  'Download 下载 now',
  '点击 Download 下载',
  'Mute · Share screen',
  '2026年11月',
  '你好！',
  'Hi，你好',
  '，你好，',
  '。开始',
  '  空 格  ',
  '第3课：你好',
  '「对话」',
  '１２个人',
  'A 我 B 你 C',
  '　全角　',
  '𠀀 字',
  '',
];

const boxes: unknown[] = [
  [10, 20, 30, 40],
  [30, 40, 10, 20],
  [0, 0, 0, 10],
  [1, 2, 3],
  [-5, 0, 2000, 10],
  [700, 350, 780, 650],
  [5.5, 10.25, 30.75, 300.5],
  null,
];

const scoreCases = lineTexts.flatMap((text) =>
  boxes.flatMap((box) => [false, true].map((main) => ({ text, box, main, score: ocrLineScore({ text, box: box as OcrLine['box'], main }) }))),
);

const orderSets: OcrLine[][] = [
  [
    { text: '新标签页 - Google Chrome', box: [5, 10, 30, 300] },
    { text: 'Share screen', box: [950, 400, 980, 600] },
    { text: '太体面了', box: [700, 350, 780, 650] },
    { text: '视频通话', box: [40, 10, 60, 120] },
    { text: '太体面了', box: [700, 350, 780, 650] },
  ],
  [{ text: '一' }, { text: '二', main: true }, { text: '三' }],
  [{ text: 'a' }, { text: '' }],
  Array.from({ length: 20 }, (_, i) => ({ text: `字${i}`, box: [i * 40, 100, i * 40 + 20 + (i % 3) * 5, 400] as [number, number, number, number] })),
  [
    { text: '左上角', box: [0, 0, 50, 100] },
    { text: '中间', box: [480, 450, 520, 550] },
    { text: '大标题', box: [100, 100, 300, 900], main: false },
    { text: '同分', box: [480, 450, 520, 550] },
  ],
];

writeFileSync(
  join(OUT, 'add-tab.json'),
  JSON.stringify({
    tiles: ADD_CONTENT_TILES,
    formats: ADD_AUDIO_FORMATS,
    content: contentCases,
    results,
    classify: texts.map((text) => ({ text, kind: classifyWordInput(text) })),
    chinese: lineTexts.map((text) => ({ text, out: ocrChineseText(text) })),
    boxes: boxes.map((box) => ({ box, out: cleanOcrBox(box) })),
    scores: scoreCases,
    orders: orderSets.map((lines) => ({ lines, out: orderOcrLines(lines), out3: orderOcrLines(lines, 3) })),
    spans: ['太体面了', '', '𠀀字词'].flatMap((text) => [[0, 0], [1, 2], [2, 1], [-3, 0], [2, 99], [5, 6]].map(([a, b]) => ({ text, a, b, out: ocrSpan(text, a, b) }))),
    resize: [[4000, 3000], [3000, 4000], [800, 600], [1280, 1281], [1, 99999], [0, 0], [1919.5, 1080.4]].map(([w, h]) => ({ w, h, out: ocrResizeDims(w, h) })),
    found: [-1, 0, 1, 2, 12].map((n) => ({ n, out: ocrFoundLine(n) })),
  }),
);
