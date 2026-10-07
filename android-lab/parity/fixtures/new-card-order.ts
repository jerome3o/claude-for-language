/**
 * "Order new cards by" golden vectors (shared/decks/new-card-order.ts + frequency.ts), from the
 * web app's own TypeScript:
 *   - parseNewCardOrder(raw)                 (stored JSON → a full set; garbage → defaults per field)
 *   - NEW_CARD_ORDER_OPTIONS                 (the settings rows' words)
 *   - frequencyRank(hanzi, the SHIPPED list) (shared/data/frequency/word-freq.txt — the Lab reads the
 *                                             same file as a core resource; proves both parse it alike)
 *   - wordPieces / isNewWord                 (what "met" means for "New words first")
 *   - pickNewCardsByOrder                    (random candidates, orders, rooms, studied text)
 * The queue scenarios with an order live in study-queue.json (`ordered`).
 * Writes new-card-order.json; core NewCardOrderParityTest asserts NewCardOrder.kt reproduces them.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  NEW_CARD_ORDER_OPTIONS,
  isNewWord,
  parseNewCardOrder,
  pickNewCardsByOrder,
  studiedFrom,
  wordPieces,
  type NewCardOrder,
} from '../../../shared/decks/new-card-order';
import { frequencyRank, parseFrequencyList } from '../../../shared/decks/frequency';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: new-card-order <out-dir>');
mkdirSync(OUT, { recursive: true });
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, 'android-lab', 'parity'))) throw new Error(`repo root not found above ${OUT}`);
const shipped = parseFrequencyList(readFileSync(join(root, 'shared/data/frequency/word-freq.txt'), 'utf8'));

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
const rand = rng(20261007);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const bool = () => rand() < 0.5;

// ---- settings ----
const RAW = [
  null, '', 'not json', '[]', '{}', '[true]', '{"new_words_first":false}', '{"sentences_last":"false"}',
  '{"most_common_first":0}', '{"new_characters_first":false,"new_words_first":false,"most_common_first":false,"sentences_last":false}',
  '{"new_characters_first":true,"extra":1}', 'null', '"x"', '{"sentences_last":null}',
];
const settings = RAW.map(raw => ({ raw, order: parseNewCardOrder(raw) }));
for (let i = 0; i < 20; i++) {
  const obj: Record<string, unknown> = {};
  for (const k of ['new_characters_first', 'new_words_first', 'most_common_first', 'sentences_last']) {
    if (rand() < 0.7) obj[k] = pick([true, false, 'true', 1, null]);
  }
  const raw = JSON.stringify(obj);
  settings.push({ raw, order: parseNewCardOrder(raw) });
}

// ---- frequency ----
const words = [...shipped.words.keys()];
const SAMPLES = [
  '的', '银行', '熊猫', '不客气', '我们明天去北京看长城。', 'OK', '', ' 你好！', 'T恤', '𠮷野家', '卡拉OK',
  '豈', 'ひらがな', '高高兴兴', '喝咖啡', '老师您好', words[0], words[words.length - 1], words[12345],
];
for (let i = 0; i < 150; i++) SAMPLES.push(pick(words));
for (let i = 0; i < 50; i++) SAMPLES.push(pick(words) + pick(words));
const frequency = {
  words: shipped.words.size,
  chars: shipped.chars.size,
  ranks: SAMPLES.map(hanzi => ({ hanzi, rank: frequencyRank(hanzi, shipped) })),
};

// ---- studied / new words ----
const TEXT = [
  '你好', '你', '好', '你们', '我们', '人', '好人', '大人', '大学', '大学生', '学生', '学', '银行', '银', '行',
  '我在银行工作。', '工作', '咖啡', '喝咖啡', '茶', '中国', '中国人', '我是学生。', '你好吗？', '老师', 'T恤', '卡拉OK',
  'OK', '', ' 你好 ', '𠮷野家', '一二三四五六', '一 二', '高高兴兴', '豈', '他是王老师的儿子。', '熊猫', '熊',
];
const studied: unknown[] = [];
for (let i = 0; i < 120; i++) {
  const studiedText = Array.from({ length: int(0, 8) }, () => pick(TEXT));
  const index = studiedFrom(studiedText);
  const probes = Array.from({ length: 8 }, () => pick(TEXT));
  studied.push({ studied: studiedText, probes: probes.map(h => ({ hanzi: h, newWord: isNewWord(h, index) })) });
}
const pieces = TEXT.map(hanzi => ({ hanzi, pieces: wordPieces(hanzi) }));

// ---- the picker ----
const POOL = [...TEXT, ...Array.from({ length: 30 }, () => pick(words.slice(0, 3000))), ...Array.from({ length: 10 }, () => pick(words.slice(20000)))];
const randomOrder = (): NewCardOrder => ({
  new_characters_first: bool(), new_words_first: bool(), most_common_first: bool(), sentences_last: bool(),
});
const picker: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const groups = Array.from({ length: int(1, 4) }, (_, g) => `g${g}`);
  const items = Array.from({ length: int(0, 25) }, (_, n) => ({ id: `i${i}-${String(n).padStart(2, '0')}`, hanzi: pick(POOL), group: pick(groups) }));
  const room: Record<string, number> = Object.fromEntries(groups.map(g => [g, int(0, 6)]));
  const rank: Record<string, number> = Object.fromEntries(groups.map(g => [g, int(0, 3)]));
  const studiedText = Array.from({ length: int(0, 10) }, () => pick(POOL));
  const order = i < 16
    ? { new_characters_first: !!(i & 1), new_words_first: !!(i & 2), most_common_first: !!(i & 4), sentences_last: !!(i & 8) }
    : randomOrder();
  const useFrequency = rand() < 0.8;
  const withPieces = order.new_words_first || rand() < 0.5;
  const take = int(0, 12);
  const picked = pickNewCardsByOrder(items, take, x => x.hanzi, x => x.group, g => rank[g], new Map(Object.entries(room)), x => x.id,
    order, studiedFrom(studiedText, withPieces), useFrequency ? shipped : null);
  picker.push({ items, room, rank, studied: studiedText, withPieces, order, useFrequency, take, picked: picked.map(x => x.id) });
}

writeFileSync(join(OUT, 'new-card-order.json'), JSON.stringify({
  settings, options: NEW_CARD_ORDER_OPTIONS, frequency, studied, pieces, picker,
}));
console.log(`new-card-order: ${settings.length} settings + ${frequency.ranks.length} ranks + ${studied.length} studied + ${picker.length} picker cases`);
