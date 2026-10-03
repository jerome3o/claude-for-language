/**
 * 一 / 不 tone-change golden vectors (shared/pinyin/toneChange.ts) for core/ToneChange.kt:
 *  - the TABLE of shared/pinyin/toneChange.test.ts and its other cases;
 *  - joined words, capitals, written neutrals, wrong tone changes, erhua, misalignment
 *    (tone numbers, Latin letters, wrong syllable counts, apostrophes, punctuation);
 *  - pinyin-pro's own output (raw, as the editors get it) for hundreds of strings with 一 / 不
 *    in every context — and `autoPinyin` (pinyin-pro + the rule, frontend/src/utils/autoPinyin.ts);
 *  - the same strings with the pinyin stripped of its tone changes (yī / bù everywhere),
 *    spaced and joined.
 * Writes tone-change.json; ToneChangeParityTest asserts the Kotlin port matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges, syllableTone } from '../../../shared/pinyin/toneChange';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: tone-change <out-dir>');
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
const rand = rng(20261003);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const TABLE: Array<[string, string]> = [
  ['一个', 'yī gè'], ['一样', 'yī yàng'], ['一起', 'yī qǐ'], ['一天', 'yī tiān'], ['一年', 'yī nián'],
  ['第一', 'dì yī'], ['十一', 'shí yī'], ['一月一日', 'yī yuè yī rì'], ['看一看', 'kàn yī kàn'],
  ['不是', 'bù shì'], ['不对', 'bù duì'], ['不好', 'bù hǎo'], ['不去', 'bù qù'], ['对不起', 'duì bù qǐ'],
  ['差不多', 'chà bù duō'], ['要不要', 'yào bù yào'], ['一', 'yī'], ['统一', 'tǒng yī'], ['统一了', 'tǒng yī le'],
  ['星期一的', 'xīng qī yī de'], ['第一个', 'dì yī gè'], ['一楼', 'yī lóu'], ['一年级', 'yī nián jí'],
  ['一二三', 'yī èr sān'], ['一百', 'yī bǎi'], ['一万', 'yī wàn'], ['不一样', 'bù yī yàng'],
  ['一不小心', 'yī bù xiǎo xīn'], ['一模一样', 'yī mú yī yàng'], ['这是一本书。', 'zhè shì yī běn shū.'],
  ['一，二', 'yī, èr'], ['不客气', 'bù kè qì'], ['好不好', 'hǎo bù hǎo'], ['你好', 'nǐ hǎo'],
  ['一点儿', 'yī diǎn ér'], ['一点儿', 'yīdiǎnr'], ['一个人', 'yí ge rén'], ['一个', 'yī ge'],
  // other test cases
  ['一样', 'yīyàng'], ['不是我。', 'Bù shì wǒ.'], ['我不是学生', 'wǒ bùshì xuéshēng'],
  ['对不起', 'duìbuqǐ'], ['看一看', 'kàn yi kàn'], ['一样', 'yíyàng'], ['一天', 'yí tiān'], ['不好', 'bú hǎo'],
  ['我也不好', 'wǒ yě bù hǎo'], ['一个', 'yi1 ge4'], ['一个人', 'yī gè'], ['A一个', 'A yī gè'],
  ['一个', 'hello world'], ['你好', 'nǐ hǎo'], ['', ''], ['一会儿', 'yí huì er'], ['一直', 'yì zhí'],
  // more: capitals, apostrophes, punctuation, erhua, misalignment
  ['一个', 'YĪ GÈ'], ['一个', 'Yī gè'], ['不对', 'BÙ duì'], ['一样', "yī'yàng"], ['不爱', "bù'ài"],
  ['一，不', 'yī, bù'], ['一！', 'yī!'], ['“不”', '“bù”'], ['不', 'bù'], ['不了', 'bù le'],
  ['一下儿', 'yī xià ér'], ['一下儿', 'yīxiàr'], ['一会儿', 'yīhuìr'], ['一块儿', 'yī kuài r'],
  ['一个', 'yī'], ['一', 'yī gè'], ['一个', 'yī gè ma'], ['一个', '  yī  gè  '], ['一个', 'yi ge'],
  ['一个', 'yī gè 1'], ['一B', 'yī bì'], ['一个？', 'yī gè?'], ['一个', 'yī-gè'], ['一个', 'yī·gè'],
  ['二十一', 'èr shí yī'], ['一千', 'yī qiān'], ['一亿', 'yī yì'], ['万一', 'wàn yī'], ['唯一', 'wéi yī'],
  ['之一', 'zhī yī'], ['初一', 'chū yī'], ['一号', 'yī hào'], ['五月一号', 'wǔ yuè yī hào'], ['五月一日', 'wǔ yuè yī rì'],
  ['一两', 'yī liǎng'], ['一一', 'yī yī'], ['不不', 'bù bù'], ['一不', 'yī bù'], ['不一', 'bù yī'],
  ['想一想', 'xiǎng yī xiǎng'], ['试一试', 'shì yī shì'], ['来不来', 'lái bù lái'], ['是不是', 'shì bù shì'],
  ['一个', 'yī ge'], ['一些', 'yī xiē'], ['一定', 'yī dìng'], ['一般', 'yī bān'], ['一共', 'yī gòng'],
  ['不用', 'bù yòng'], ['不错', 'bù cuò'], ['不过', 'bù guò'], ['不同', 'bù tóng'], ['不能', 'bù néng'],
  ['一個', 'yī gè'], ['不會', 'bù huì'], ['一𠀋', 'yī shàng'], ['一了', 'yī le'], ['一的', 'yī de'],
  ['我一个人去不去', 'wǒ yī gè rén qù bù qù'], ['一路平安', 'yī lù píng ān'], ['一心一意', 'yī xīn yī yì'],
  ['不三不四', 'bù sān bù sì'], ['一五一十', 'yī wǔ yī shí'], ['一年级的学生', 'yī nián jí de xué shēng'],
  ['一樣', 'yi yang'], ['一个', 'yī gè́'], ['一个', 'yī gè'], ['不是', 'bù shì'],
  ['一个', 'yǐ gè'], ['不是', 'bǔ shì'], ['一个', 'yū gè'], ['一个', 'xyz gè'], ['一ê', 'yī ê'],
  ['不了了之', 'bù liǎo liǎo zhī'], ['一zhang', 'yī zhāng'],
];

const AROUND = ['我', '你', '他', '是', '去', '看', '想', '说', '来', '好', '对', '天', '年', '起', '样', '个', '本', '次', '点', '下',
  '百', '千', '万', '第', '统', '十', '二', '月', '日', '号', '楼', '期', '星', '了', '的', '吗', '会', '要', '能', '用', '错', '同', '过',
  '儿', '，', '。', '？', ' ', 'A', '1', '两', '级', '唯', '之', '初', '专', '单', '划', '归', '逐', '合', '纯', '客', '气', '小', '心'];
const WORDS = ['一个', '一样', '一起', '一天', '一年', '一点儿', '一会儿', '一下', '一定', '一共', '一直', '一般', '不是', '不好', '不对',
  '不去', '不客气', '对不起', '差不多', '看一看', '要不要', '好不好', '第一', '十一', '星期一', '一月一日', '统一', '唯一', '一模一样',
  '一不小心', '不一样', '一百', '一千', '一万', '一楼', '一年级', '我不是学生', '这是一本书。', '你好', '谢谢', '中国人'];

function corpus(): string[] {
  const out = new Set<string>(WORDS);
  for (let i = 0; i < 700; i++) {
    let s = '';
    const n = int(1, 6);
    for (let k = 0; k < n; k++) {
      const r = rand();
      s += r < 0.25 ? '一' : r < 0.45 ? '不' : r < 0.65 ? pick(WORDS) : pick(AROUND);
    }
    if (/[一不]/.test(s)) out.add(s);
  }
  return [...out];
}

/** Undo the tone changes: every yi / bu syllable back to yī / bù (what a dictionary or Claude may write). */
function strip(p: string): string {
  return p.replace(/\by[iīíǐì](?![a-zāáǎàēéěèīíǐìōóǒòūúǔù])/g, 'yī').replace(/\bb[uūúǔù](?![a-zāáǎàēéěèīíǐìōóǒòūúǔù])/g, 'bù');
}

const cases: Array<{ hanzi: string; pinyin: string; out: string }> = [];
const add = (hanzi: string, p: string) => cases.push({ hanzi, pinyin: p, out: applyYiBuToneChanges(hanzi, p) });
for (const [h, p] of TABLE) add(h, p);

const auto: Array<{ text: string; raw: string; out: string }> = [];
for (const text of corpus()) {
  const raw = pinyin(text, { toneType: 'symbol', type: 'string' });
  auto.push({ text, raw, out: applyYiBuToneChanges(text, raw) });
  add(text, raw);
  const s = strip(raw);
  add(text, s);
  add(text, s.replace(/ /g, ''));
  if (rand() < 0.2) add(text, s.charAt(0).toUpperCase() + s.slice(1));
}

const tones = ['mā', 'má', 'mǎ', 'mà', 'ma', 'lǜ', 'LǛ', 'Ā', 'yi', 'ê', 'é', 'ǖe', 'xx', ''].map(s => ({ s, tone: syllableTone(s) }));

writeFileSync(join(OUT, 'tone-change.json'), JSON.stringify({ cases, auto, tones }));
console.log(`tone-change: ${cases.length} cases, ${auto.length} auto-pinyin strings`);
