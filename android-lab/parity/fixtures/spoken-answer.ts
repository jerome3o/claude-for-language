/**
 * Golden vectors for the typing cards' answer check and its spoken mode
 * (shared/cards/answer.ts: `checkTypedAnswer`, `checkSpokenAnswer`, `spokenPinyinKey`,
 * `normalizeSpokenPinyin`, `tonelessPinyin`, `spokenVerdictNote`) for core/AnswerKey.kt.
 *
 * Cases: a hand-made table (homophones 由 / 油 / 游, tones off, 一 / 不, numbers, punctuation,
 * alternatives, the note's own pinyin, English heard) plus thousands of seeded ones built from
 * a pool of common characters grouped by their pinyin: an expected word, then a transcript with
 * one character swapped for a homophone, a same-syllable / other-tone character or any other,
 * punctuation added, digits for numbers, the word (or a homophone / other-tone version) said
 * inside a sentence, the note's pinyin with one neutral syllable — with `spokenAnswerWithin`
 * (typing card + read card) and `spokenSyllables`. Writes spoken-answer.json into process.argv[2];
 * SpokenAnswerParityTest asserts the Kotlin port gives exactly the same answers.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import {
  checkSpokenAnswer,
  checkTypedAnswer,
  normalizeSpokenPinyin,
  spokenAnswerWithin,
  spokenPinyinKey,
  spokenSyllables,
  spokenVerdictNote,
  tonelessPinyin,
} from '../../../shared/cards/answer';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: spoken-answer <out-dir>');
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
const rand = rng(20261008);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

interface Case { transcript: string; correct: string; alternatives: string[]; note_pinyin: string }

const TABLE: Case[] = [
  ['油', '由'], ['游', '由'], ['由', '由'], ['有', '由'], ['又', '由'], ['you', '由'], ['', '由'], ['   ', '由'],
  ['她是我的朋友', '他是我的朋友'], ['它是我的朋友。', '他是我的朋友'], ['银航', '银行'], ['因行', '银行'],
  ['在见', '再见'], ['再见！', '再见'], ['买', '卖'], ['卖', '卖'], ['猫', '狗'], ['衣个', '一个'], ['一个', '一个'],
  ['医个', '一个'], ['不是', '不是'], ['布是', '不是'], ['步是', '不是'], ['我有7个', '我有七个'], ['我有七个', '我有7个'],
  ['我有两个', '我有二个'], ['ma', '吗'], ['吗？', '吗'], ['妈', '吗'], ['码', '吗'], ['你好', '您好'], ['你号', '你好'],
  ['泥好', '你好'], ['拟好', '你好'], ['nǐ hǎo', '你好'], ['你好 hello', '你好'], ['我想 order 一个 coffee', '我想点一个咖啡'],
  ['涨', '长'], ['场', '长'], ['常', '长'], ['十一', '11'], ['11', '十一'], ['第一', '第一'], ['帝一', '第一'],
  ['一样', '一样'], ['衣样', '一样'], ['女儿', '女儿'], ['旅儿', '女儿'], ['西安', '西安'], ['先', '西安'],
].map(([transcript, correct]) => ({ transcript, correct, alternatives: [], note_pinyin: '' }));
TABLE.push(
  { transcript: '涨', correct: '长', alternatives: [], note_pinyin: 'zhǎng' },
  { transcript: '场', correct: '长', alternatives: [], note_pinyin: 'cháng' },
  { transcript: '泥好', correct: '你好', alternatives: ['您好'], note_pinyin: 'nǐ hǎo' },
  { transcript: '您好', correct: '你好', alternatives: ['您好'], note_pinyin: 'nǐ hǎo' },
  { transcript: '宁好', correct: '你好', alternatives: ['您好'], note_pinyin: 'nǐ hǎo' },
  { transcript: '衣个', correct: '一个', alternatives: [], note_pinyin: 'yī gè' },
  { transcript: '西安', correct: '西安', alternatives: [], note_pinyin: "Xī'ān" },
  { transcript: '希安', correct: '西安', alternatives: [], note_pinyin: "Xī'ān" },
  { transcript: '女儿', correct: '女儿', alternatives: [], note_pinyin: 'NǙ ÉR' },
  { transcript: '旅儿', correct: '女儿', alternatives: [], note_pinyin: 'nü3 er2' },
  { transcript: '吕', correct: '女', alternatives: [], note_pinyin: 'nǚ' },
  { transcript: '律', correct: '绿', alternatives: [], note_pinyin: 'lǜ' }, // decomposed ǜ
  { transcript: '油', correct: '由', alternatives: ['游'], note_pinyin: 'yóu' },
  { transcript: '有', correct: '由', alternatives: [], note_pinyin: 'you2' },
  // Said inside a sentence (`contains`, the read card's rule): hanzi, a homophone window, a
  // neutral syllable of the answer (长得 zhǎng de vs the automatic dé), one-character answers,
  // the word not said, an all-neutral answer (no allowance), pinyin without tone marks.
  { transcript: '他长得很好。', correct: '长得', alternatives: [], note_pinyin: 'zhǎngde' },
  { transcript: '他长得很好。', correct: '长得', alternatives: [], note_pinyin: '' },
  { transcript: '涨得', correct: '长得', alternatives: [], note_pinyin: 'zhǎng de' },
  { transcript: '他涨得很好', correct: '长得', alternatives: [], note_pinyin: 'zhǎng de' },
  { transcript: '涨得', correct: '长得', alternatives: [], note_pinyin: 'zhang de' },
  { transcript: '他很高', correct: '长得', alternatives: [], note_pinyin: 'zhǎngde' },
  { transcript: '我想去银航取钱', correct: '银行', alternatives: [], note_pinyin: '' },
  { transcript: '我想去銀行', correct: '银行', alternatives: [], note_pinyin: '' },
  { transcript: '老师您好！', correct: '你好', alternatives: ['您好'], note_pinyin: '' },
  { transcript: '我有7个苹果', correct: '七个', alternatives: [], note_pinyin: '' },
  { transcript: '我今天很好', correct: '好', alternatives: [], note_pinyin: '' },
  { transcript: '我想去游泳', correct: '由', alternatives: [], note_pinyin: '' },
  { transcript: '妈', correct: '吗', alternatives: [], note_pinyin: '' },
  { transcript: '你是谁吗', correct: '吗', alternatives: [], note_pinyin: '' },
  { transcript: 'ok油', correct: '由', alternatives: [], note_pinyin: '' },
  { transcript: '我觉的很好', correct: '觉得', alternatives: [], note_pinyin: 'juéde' },
  { transcript: '我决的很好', correct: '觉得', alternatives: [], note_pinyin: '' },
  { transcript: '看一看吧', correct: '看一看', alternatives: [], note_pinyin: 'kàn yi kàn' },
);

// A pool of common characters, grouped by toned and toneless pinyin.
const POOL = Array.from(new Set(Array.from(
  '的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湖钟奔孙赶贵阿妹吸卖汽票牌泪油狗猫旅吕绿律涨场衣医希宁泥拟帝').filter(c => /\p{Script=Han}/u.test(c))));
const toned = new Map<string, string[]>();
const bare = new Map<string, string[]>();
const add = (m: Map<string, string[]>, k: string, c: string) => { const l = m.get(k); if (l) l.push(c); else m.set(k, [c]); };
const readingOf = new Map<string, string>();
for (const c of POOL) {
  const py = pinyin(c, { toneType: 'symbol', type: 'string' });
  readingOf.set(c, py);
  add(toned, py, c);
  add(bare, tonelessPinyin(normalizeSpokenPinyin(py)), c);
}

function swap(word: string[], i: number, how: 'homophone' | 'tone' | 'any'): string[] {
  const c = word[i];
  const py = readingOf.get(c) ?? '';
  let options: string[] = [];
  if (how === 'homophone') options = (toned.get(py) ?? []).filter(x => x !== c);
  else if (how === 'tone') options = (bare.get(tonelessPinyin(normalizeSpokenPinyin(py))) ?? []).filter(x => readingOf.get(x) !== py);
  else options = POOL.filter(x => x !== c);
  if (options.length === 0) return word;
  const out = [...word];
  out[i] = pick(options);
  return out;
}

function neutralOne(hanzi: string): string {
  const syl = pinyin(hanzi, { toneType: 'symbol', type: 'array' });
  const i = int(0, syl.length - 1);
  syl[i] = tonelessPinyin(normalizeSpokenPinyin(syl[i]));
  return syl.join(rand() < 0.5 ? ' ' : '');
}

const PUNCT = ['。', '！', '？', '，', ' ', '.', '?', '“', '”'];
const cases: Case[] = [...TABLE];
const around = () => Array.from({ length: int(0, 4) }, () => pick(POOL)).join('');
for (let n = 0; n < 5000; n++) {
  const word = Array.from({ length: int(1, 5) }, () => pick(POOL));
  const correct = word.join('');
  const kind = pick(['same', 'homophone', 'homophone', 'tone', 'tone', 'any', 'two', 'punct', 'number', 'latin',
    'sentence', 'sentence', 'sentence_homophone', 'sentence_tone'] as const);
  let heard = word;
  if (kind === 'homophone' || kind === 'tone' || kind === 'any') heard = swap(word, int(0, word.length - 1), kind);
  if (kind === 'two') heard = swap(swap(word, 0, 'homophone'), word.length - 1, pick(['homophone', 'tone'] as const));
  if (kind === 'sentence_homophone') heard = swap(word, int(0, word.length - 1), 'homophone');
  if (kind === 'sentence_tone') heard = swap(word, int(0, word.length - 1), 'tone');
  let transcript = heard.join('');
  // The word (or a homophone / other-tone version of it) said inside a sentence.
  if (kind.startsWith('sentence')) transcript = around() + transcript + around() + (rand() < 0.5 ? pick(PUNCT) : '');
  if (kind === 'punct') transcript = (rand() < 0.3 ? pick(PUNCT) : '') + transcript + pick(PUNCT);
  if (kind === 'number') transcript = transcript + String(int(0, 120));
  if (kind === 'latin') transcript = pick(['ok', 'Hello ', 'you', 'ma', 'nǐ ']) + transcript;
  const alternatives = rand() < 0.2 ? [swap(word, 0, pick(['homophone', 'tone', 'any'] as const)).join('')] : [];
  const r = rand();
  const note_pinyin = r < 0.4
    ? pinyin(correct, { toneType: 'symbol', type: 'string' })
    : r < 0.55 ? pinyin(heard.join(''), { toneType: 'symbol', type: 'string' }).toUpperCase()
      : r < 0.65 ? pinyin(correct, { toneType: 'num', type: 'string' })
        // The card's pinyin with one syllable neutral (觉得 juéde): the neutral allowance.
        : r < 0.75 ? neutralOne(correct) : '';
  cases.push({ transcript, correct, alternatives, note_pinyin });
}

const out = cases.map((c) => ({
  ...c,
  typed: checkTypedAnswer(c.transcript, c.correct, c.alternatives),
  spoken: checkSpokenAnswer(c.transcript, c.correct, c.alternatives, c.note_pinyin),
  heard_key: spokenPinyinKey(c.transcript),
  correct_key: spokenPinyinKey(c.correct),
  note_key: normalizeSpokenPinyin(c.note_pinyin),
  toneless: tonelessPinyin(spokenPinyinKey(c.correct)),
  within: spokenAnswerWithin(c.transcript, c.correct, c.alternatives, c.note_pinyin),
  within_read: spokenAnswerWithin(c.transcript, c.correct),
  syllables: spokenSyllables(c.transcript),
}));
const verdicts = ['exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains', 'close', 'wrong'] as const;
const notes = verdicts.map((v) => ({ verdict: v, correct: '由', note: spokenVerdictNote(v, ' 由 ') }));
const counts = Object.fromEntries(verdicts.map((v) => [v, out.filter((c) => c.spoken === v).length]));
writeFileSync(join(OUT, 'spoken-answer.json'), JSON.stringify({ cases: out, notes, counts }));
