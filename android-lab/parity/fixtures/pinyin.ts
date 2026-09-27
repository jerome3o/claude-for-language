/**
 * Golden vectors for core/Pinyin.kt: the real pinyin-pro (the web editors' `toPinyin`,
 * frontend/src/components/editor/fields.tsx) run over a large corpus. Writes pinyin.json
 * into process.argv[2]; PinyinParityTest asserts the Kotlin port returns exactly the same
 * string for every case.
 *
 * Corpus (deterministic — sorted file walk + seeded mulberry32):
 *  - every Chinese-bearing string in shared/, the starter deck and the zh-CN tutor guide;
 *  - thousands of random strings mixing dictionary words (multi-character words, polyphones,
 *    number-rule words), common / traditional / rare / supplementary characters, 一 and 不 in
 *    every sandhi context (说一说, 一 + each tone, the ignore-suffixes), 了, 々, numbers,
 *    ASCII, digits, punctuation, spaces, emoji and lone surrogates;
 *  - long strings, which push the max-probability DP through its 1e-300 rescaling.
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pinyin } from 'pinyin-pro';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: pinyin <out-dir>');
mkdirSync(OUT, { recursive: true });

// The repo root: walk up from the output directory (android-lab/core/build/parity).
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, 'android-lab', 'parity'))) throw new Error(`repo root not found above ${OUT}`);

// mulberry32
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
const rand = rng(20260928);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const toPinyin = (s: string) => pinyin(s, { toneType: 'symbol', type: 'string' });
const toPinyinNone = (s: string) => pinyin(s, { toneType: 'none', type: 'string' });

const inputs: string[] = [];
const seen = new Set<string>();
const add = (s: string) => {
  if (seen.has(s)) return;
  seen.add(s);
  inputs.push(s);
};

// ---- hand-picked ----
[
  '', ' ', '你好', '一个', '一', '不', '不对', '不是', '一样', '一天', '一年', '一百', '一千', '一万', '十一', '第一',
  '一十一', '一重', '两行', '一行', '说一说', '看不看', '好不好', '想一想', '试一试', '一不做', '了', '了解', '好了',
  '走了', '了了', '々', '人々', '々々', '我々', 'a々', '中国人', '重庆', '行长', '银行', '长大', '长城', '为什么',
  '这个', '那个', '一会儿', 'Hello 世界!', '😀一', '一😀', '𠀀', '𠀀々', 'a  b', '你好吗？我很好。', '学習', '說話',
  '他说：“不，我不去。”', '一的', '不的', '一是', '一还', '不也', '一后', '不地', '一1', '1一', '一a', 'a不b',
  '\uD800', '一\uD800', '\uDC00一', '\uDC00\uD800', '一 一', '不 不', '一。一', '３个', 'ＡＢＣ汉字', '一\n二', '\t不\t',
].forEach(add);

// ---- corpus from the repo ----
const HAN = /[㐀-鿿]/;
function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|md)$/.test(name)) out.push(p);
  }
}
const files: string[] = [];
walk(join(root, 'shared'), files);
for (const f of ['worker/src/services/starter-deck.ts', 'docs/TUTOR_GUIDE.zh-CN.md']) {
  if (existsSync(join(root, f))) files.push(join(root, f));
}
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!HAN.test(line)) continue;
    for (const m of line.match(/[^'"`\n]*[㐀-鿿][^'"`\n]*/g) ?? []) {
      const s = m.trim();
      if (s.length > 0 && s.length <= 240) add(s);
    }
  }
}
const repoCount = inputs.length;

// ---- random strings ----
const dictText = readFileSync(join(root, 'android-lab/core/src/main/resources/pinyin/pinyin-dict.txt'), 'utf8');
const words: string[] = [];
const dictChars: string[] = [];
let section = '';
for (const line of dictText.split('\n')) {
  if (line.startsWith('#')) { section = line; continue; }
  if (!line) continue;
  const [a] = line.split('\t');
  if (section === '#words') words.push(a);
  else if (section === '#chars') dictChars.push(...[...line.split('\t')[1]]);
}
const COMMON = [...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坏兴切团吗哪姐妹冷热茶饭米汤酒楼街店钟票课词句难累渴饿饱睡醒哭跑跳唱玩'];
const TRADITIONAL = [...'學習說話們開關門東車馬鳥書長來時國語寫讀聽見點問題應該會對過還這個樣體實現發電腦網絡經濟業務處數據庫歡樂愛戀龍鳳飛'];
const SUPPLEMENTARY = ['𠀀', '𠀁', '𪚥', '𠮷', '𡈽', '𤭢', '𦍌', '𩸽', '𫄷', '𬬩', '𬟁', '𰻞'];
const EMOJI = ['😀', '🐉', '👍🏽', '🇨🇳', '❤️', '🎉'];
const PUNCT = [...'，。！？、；：“”‘’（）《》…—·', ...',.!?;:\'"()[]-_/\\@#%&*+=<>~'];
const ASCII_WORDS = ['a', 'OK', 'hello', 'Beijing', 'WiFi', 'App', 'x', 'CEO', 'pinyin', 'ni3'];
const SPACES = [' ', '  ', '\t', '\n', '　', ' '];
const SANDHI_NEXT = [...'个样天年百千次块是的而之后也还地对去要会来说见看想试做走吃人本些点起直定般切'];
const NUMS = [...'零〇一二三四五六七八九十百千万亿两双单多几第'];
const NUMBER_WORDS = ['一重', '十一', '第一', '一十', '一十一', '零一', '〇一', '两行', '三更', '五斗', '一百', '一千零一', '二十一', '第十一', '一亿'];

function rareChar(): string {
  // any code point in the CJK blocks — many are not in DICT1
  const cp = rand() < 0.7 ? int(0x4e00, 0x9fff) : int(0x3400, 0x4dbf);
  return String.fromCodePoint(cp);
}
function token(): string {
  const r = rand();
  if (r < 0.28) return pick(words);
  if (r < 0.48) return pick(COMMON);
  if (r < 0.56) return pick(dictChars);
  if (r < 0.63) return rand() < 0.5 ? '一' : '不';
  if (r < 0.66) return '了';
  if (r < 0.675) return '々';
  if (r < 0.71) return rand() < 0.5 ? pick(NUMS) : pick(NUMBER_WORDS);
  if (r < 0.74) return pick(ASCII_WORDS);
  if (r < 0.76) return String(int(0, 2000));
  if (r < 0.83) return pick(PUNCT);
  if (r < 0.86) return pick(SPACES);
  if (r < 0.875) return pick(EMOJI);
  if (r < 0.905) return pick(TRADITIONAL);
  if (r < 0.935) return rareChar();
  if (r < 0.95) return pick(SUPPLEMENTARY);
  if (r < 0.953) return rand() < 0.5 ? '\uD83D' : '\uDE00'; // lone surrogates
  const x = pick(COMMON);
  return pick([`${x}一${x}`, `${x}不${x}`, `一${pick(SANDHI_NEXT)}`, `不${pick(SANDHI_NEXT)}`, `${pick(words)}了`, `了${pick(words)}`]);
}
function randomString(maxTokens: number): string {
  const n = int(1, maxTokens);
  let s = '';
  for (let i = 0; i < n; i++) s += token();
  return s;
}

// every 一 / 不 context against every common char, and X一X / X不X
for (const c of COMMON.slice(0, 400)) {
  add(`一${c}`);
  add(`不${c}`);
  add(`${c}一${c}`);
  add(`${c}不${c}`);
  add(`${c}了`);
  add(`${c}々`);
}
for (const c of SANDHI_NEXT) {
  add(`一${c}`);
  add(`不${c}`);
}
for (let i = 0; i < 1500; i++) add(pick(words));
for (let i = 0; i < 4000; i++) add(randomString(8));
for (let i = 0; i < 2500; i++) add(randomString(30));
// long: the DP's probability underflows below 1e-300 and is rescaled (checkDecimal)
for (let i = 0; i < 150; i++) add(randomString(200));
for (let i = 0; i < 60; i++) {
  let s = '';
  const n = int(20, 400);
  for (let k = 0; k < n; k++) s += rand() < 0.5 ? pick(COMMON) : rareChar();
  add(s);
}
for (let i = 0; i < 30; i++) {
  let s = '';
  const n = int(30, 300);
  for (let k = 0; k < n; k++) s += pick(PUNCT) + pick(ASCII_WORDS);
  add(s);
}

const cases = inputs.map((s, i) => [s, toPinyin(s), i % 4 === 0 ? toPinyinNone(s) : null]);
writeFileSync(join(OUT, 'pinyin.json'), JSON.stringify({ repo_strings: repoCount, cases }));
