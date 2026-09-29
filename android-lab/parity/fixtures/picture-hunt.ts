/**
 * Golden vectors for the Kotlin port of shared/picture-hunt (android-lab/core/…/PictureHunt.kt):
 * answer normalisation (NFKC, lower case, \s / \p{P} / \p{S} stripped, trad → simp, leading
 * numeral / demonstrative + measure word), pinyin keys (marks, numbers, toneless, ü / v),
 * matchHuntAnswer over hand-picked and seeded inputs × found sets, huntFeedback, hints, and the
 * geometry (pointInPolygon, regionContains, objectAt with slop, labelAnchor, Math.hypot).
 * Writes picture-hunt.json; checked by core/…/PictureHuntParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  hintText,
  matchHuntAnswer,
  normalizeHanziAnswer,
  objectArea,
  pickHintTarget,
  pinyinKey,
  stripAnswer,
  toSimplified,
  hasHanzi,
} from '../../../shared/picture-hunt/match';
import { labelAnchor, objectAt, pointInPolygon, regionContains } from '../../../shared/picture-hunt/geometry';
import { huntFeedback } from '../../../shared/picture-hunt/feedback';
import { PICTURE_HUNT_DEFAULT_SECONDS, type HuntObject, type HuntRegion } from '../../../shared/picture-hunt/types';

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
const rand = rng(8675309);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

function obj(id: string, hanzi: string, pinyin: string, english: string, alternatives: string[] = [], regions: HuntRegion[] = [{ box: { x: 0, y: 0, w: 0.1, h: 1 } }]): HuntObject {
  return { id, hanzi, pinyin, english, alternatives, regions };
}

// ---------------- matching ----------------

const KITCHEN: HuntObject[] = [
  obj('cup', '茶杯', 'chábēi', 'cup', ['杯子', '杯']),
  obj('table', '桌子', 'zhuōzi', 'table', ['饭桌']),
  obj('chair', '椅子', 'yǐzi', 'chair'),
  obj('tv', '电视', 'diànshì', 'television', ['电视机'], [{ box: { x: 0.5, y: 0.1, w: 0.3, h: 0.3 } }]),
  obj('book', '书', 'shū', 'book'),
  obj('green', '绿色', 'lǜsè', 'green'),
  obj('lamp', '台灯', 'táidēng', 'desk lamp', ['灯']),
  obj('apple', '苹果', 'píngguǒ', 'apple'),
  obj('clock', '钟', 'zhōng', 'clock', ['时钟', '钟表']),
  obj('pot', '茶壶', 'cháhú', 'teapot'),
  obj('noodles', '面条', 'miàntiáo', 'noodles', ['面']),
  obj('woman', '女儿', 'nǚ\'ér', 'daughter'),
];
const SHARED_ALT: HuntObject[] = [obj('a', '水杯', 'shuǐbēi', 'glass', ['杯子']), obj('b', '茶杯', 'chábēi', 'teacup', ['杯子']), obj('c', '杯', 'bēi', 'cup', [])];
const SETS: HuntObject[][] = [KITCHEN, SHARED_ALT, [obj('x', '一个', 'yígè', 'one'), obj('y', '这', 'zhè', 'this', ['那'])]];

const HAND = [
  '', ' ', '。', '　', ' 。！', '茶杯', '杯子', '杯', '  桌 子。', '桌子！', '「茶杯」', '"杯子"', '《书》', '杯-子', '杯_子', '杯·子', '杯…子',
  '杯子😀', '🍵茶杯', '杯子+', '$书', '©书', '书™', '＃书', '書', '電視', '電視機', '蘋果', '臺燈', '檯燈', '鐘', '鐘錶', '麵條', '時鐘',
  '一张桌子', '这本书', '那本書', '两杯茶', '三个苹果', '一個蘋果', '每个', '一个', '5张桌子', '５张桌子', '十几把椅子', '一张', '这', '一杯',
  '茶壶', '壶', '被子', '桌', '椅', '儿子', '女', '水杯', '茶',
  'chá bēi', 'cha2bei1', 'CHA2 BEI1', 'Chá Bēi', 'chabei', 'cha1bei1', 'zhuo1 zi5', 'zhuo1zi0', 'zhuōzi', 'zhuozi', 'Dian4shi4', 'dian4 shi4 ji1',
  'lǜ sè', 'lv4se4', 'lü4se4', 'lu4se4', 'lüse', 'lvse', 'LǛ SÈ', 'nü3er2', 'nv3\'er2', 'nǚ\'ér', 'nuer', 'ping2guo3', 'píng guǒ', 'pingguo',
  'chábēi', 'ｃｈａ２ｂｅｉ１', 'ｃｈá', 'shu1', 'shū', 'shu', 'shu3', 'hello', '123', '4', 'zhong1', 'mian4tiao2', 'bei1',
  'shuǐbēi', 'bei1zi', 'x', '!!!', '🍎', 'ÅĀ', 'İ', 'ΣΟΦΟΣ',
];
const PREFIXES = ['', ' ', '一个', '这', '两张', '那本', '「', '　', '3只', '每'];
const SUFFIXES = ['', '。', '！', ' ', '😀', '?', '」', '啊'];

const inputs = new Set<string>(HAND);
for (let i = 0; i < 400; i++) {
  const o = pick(KITCHEN);
  const base = pick([o.hanzi, ...o.alternatives, o.pinyin, toSimplified(o.hanzi), o.pinyin.toUpperCase(), o.pinyin.replace(/[̀-ͯ]/g, '')]);
  let s = pick(PREFIXES) + base + pick(SUFFIXES);
  if (rand() < 0.2) s = s.normalize('NFD');
  if (rand() < 0.15) s = Array.from(s).slice(0, Math.max(1, int(1, Array.from(s).length))).join('');
  inputs.add(s);
}
// the whole traditional table, a character at a time
const tradChars = Array.from('書車門燈電腦視鐘錶鍋盤雞魚鳥馬貓紙筆簾櫃麵飯蘋葉樹園褲襪錢機們個張隻條塊雙盞臺輛頭蘿蔔餅湯麥醬鹽壺爐燒籃鏡畫牆樓開關風傘鑰鎖橋鐵飛雲陽氣報話線網鍵聽讀寫說見買賣東蝦貝蠟燭蓋廳廚臥廁龍輪號碼標誌貨攤餃醫藥櫻檸鳳紅綠藍黃顏豬鴨鵝蟲籠裡邊對備環從會學習題問時間館場廣華國語漢樣還這過進運動腳臉髮衛牀櫥屜鬧鈴壓厭鍾銀鋼釘針錄鞦韆擺飾傢俱廈總統軌錫鉛鑽劍盃罈蓮');

const FOUND_SETS: string[][] = [[], ['cup'], ['cup', 'table', 'tv'], ['a'], ['b'], ['a', 'b'], ['x'], ['book', 'green', 'lamp', 'apple', 'clock']];

const matches: unknown[] = [];
SETS.forEach((objects, setIndex) => {
  for (const input of inputs) {
    for (const found of FOUND_SETS) {
      if (found.some((id) => !objects.some((o) => o.id === id))) continue;
      const m = matchHuntAnswer(input, objects, found);
      matches.push({ set: setIndex, input, found, match: m, feedback: huntFeedback(m, objects) });
    }
  }
});

// Normalisation of every BMP code point (skipping surrogates): only the ones stripAnswer /
// toSimplified change are listed, as [codePoint, stripAnswer(ch), toSimplified(ch), hasHanzi(ch)].
const bmp: Array<[number, string, string, boolean]> = [];
for (let cp = 0; cp < 0x10000; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);
  const stripped = stripAnswer(ch);
  const simplified = toSimplified(ch);
  const han = hasHanzi(ch);
  if (stripped !== ch || simplified !== ch || han) bmp.push([cp, stripped, simplified, han]);
}
const EMOJI_ETC = ['😀', '🍵', '🧑‍🍳', '👍🏽', '🇨🇳', '𠀀', '𪚥', '🀄', '♥️', '⌚', '©️', '#️⃣'];

const strings = [...inputs, ...EMOJI_ETC, ...tradChars, tradChars.join('')].map((s) => ({
  s,
  strip: stripAnswer(s),
  norm: normalizeHanziAnswer(s),
  simp: toSimplified(s),
  hanzi: hasHanzi(s),
  key: pinyinKey(s),
}));

// ---------------- hints ----------------

const hints: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const objects = KITCHEN.map((o) => ({ ...o, regions: Array.from({ length: int(0, 3) }, () => ({ box: { x: rand(), y: rand(), w: pick([rand() * 0.5, 0.1, 0.2, -0.05, 0]), h: pick([rand() * 0.5, 0.1, 0.5, 0]) } })) }));
  const found = objects.filter(() => rand() < 0.3).map((o) => o.id);
  const given: Record<string, number> = {};
  for (const o of objects) if (rand() < 0.4) given[o.id] = int(0, 3);
  hints.push({ objects, found, given, target: pickHintTarget(objects, found, given)?.id ?? null, areas: objects.map(objectArea) });
}
const hintTexts = KITCHEN.flatMap((o) => [0, 1, 2, 3, 4].map((level) => ({ id: o.id, level, text: hintText(o, level) })));

// ---------------- geometry ----------------

function randomRegion(): HuntRegion {
  const x = Math.round(rand() * 900) / 1000;
  const y = Math.round(rand() * 900) / 1000;
  const w = Math.round(rand() * (1 - x) * 1000) / 1000 || 0.01;
  const h = Math.round(rand() * (1 - y) * 1000) / 1000 || 0.01;
  const region: HuntRegion = { box: { x, y, w, h } };
  if (rand() < 0.6) {
    const n = int(3, 9);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.3;
      const r = 0.3 + rand() * 0.7;
      pts.push([Math.round((cx + (Math.cos(a) * w * r) / 2) * 10000) / 10000, Math.round((cy + (Math.sin(a) * h * r) / 2) * 10000) / 10000]);
    }
    region.polygon = pts;
  } else if (rand() < 0.1) {
    region.polygon = [[x, y], [x + w, y]];
  }
  return region;
}

const scenes: unknown[] = [];
for (let s = 0; s < 120; s++) {
  const objects: HuntObject[] = Array.from({ length: int(1, 8) }, (_, i) => obj(`o${i + 1}`, '杯子', 'bēizi', 'cup', [], Array.from({ length: int(1, 3) }, randomRegion)));
  const probes: unknown[] = [];
  for (let p = 0; p < 40; p++) {
    let px: number;
    let py: number;
    if (rand() < 0.35) {
      // near an edge of some box, inside or out
      const r = pick(pick(objects).regions);
      px = r.box.x + pick([-0.015, -0.025, 0, r.box.w, r.box.w + 0.01, r.box.w + 0.03, r.box.w / 2]);
      py = r.box.y + pick([-0.01, -0.021, 0, r.box.h, r.box.h + 0.019, r.box.h / 3]);
    } else {
      px = rand() * 1.1 - 0.05;
      py = rand() * 1.1 - 0.05;
    }
    const slop = pick([0.02, 0.02, 0, 0.05]);
    probes.push({
      x: px,
      y: py,
      slop,
      at: objectAt(objects, px, py, slop)?.id ?? null,
      contains: objects.map((o) => o.regions.map((r) => regionContains(r, px, py))),
      inPoly: objects.map((o) => o.regions.map((r) => (r.polygon ? pointInPolygon(px, py, r.polygon) : null))),
    });
  }
  scenes.push({ objects, probes, anchors: objects.map((o) => o.regions.map(labelAnchor)) });
}
const hypots: Array<[number, number, number]> = [];
for (let i = 0; i < 500; i++) {
  const dx = pick([0, rand() * 0.05, rand(), 1e-9 * rand(), 0.02]);
  const dy = pick([0, rand() * 0.05, rand(), 0.015]);
  hypots.push([dx, dy, Math.hypot(dx, dy)]);
}

writeFileSync(
  join(OUT, 'picture-hunt.json'),
  JSON.stringify({ default_seconds: PICTURE_HUNT_DEFAULT_SECONDS, sets: SETS, matches, strings, bmp, hints, hint_texts: hintTexts, scenes, hypots }),
);
