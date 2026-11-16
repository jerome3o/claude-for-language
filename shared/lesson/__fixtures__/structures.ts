/**
 * Real notes from a homework mini lesson written before structure cards ("天冷起来了：除了…还… ·
 * 好＋V · 概数（多）· 起来了", 4 Nov 2026): the opening "All structures" wall of five structures and
 * the note on structure ①. Used by pattern.test.ts, the E2E spec and the Lab parity vectors.
 */
import type { NoteExercise } from '../types';

export const ALL_STRUCTURES_NOTE: NoteExercise = {
  type: 'note',
  title: 'All structures',
  body: '① 除了 + 名词／动词短语 +（以外），主语 + 还 + 动词\n   Besides + Noun / Verb phrase + (apart from), Subject + also + Verb\n   → besides A, also B\n\n② （不）好 + 动词\n   (not) easy to + Verb\n   → (not) easy to do\n\n③ 整十数 + 多 + 量词 + 名词\n   Round number (tens, hundreds…) + more + Measure word + Noun\n   → over X (twenty-odd, 100-plus…)\n\n④ 个位数 + 量词 + 多 + 名词\n   Single digit + Measure word + more + Noun\n   → a bit over X\n\n⑤ 形容词 + 起来了\n   Adjective + start to + le\n   → is starting to get [adjective]',
  sentences: [
    { hanzi: '除了跑步，他还喜欢游泳。', pinyin: 'Chúle pǎobù, tā hái xǐhuan yóuyǒng.', english: 'Besides running, he also likes swimming.' },
    { hanzi: '这个词好记吗？', pinyin: 'Zhège cí hǎo jì ma?', english: 'Is this word easy to remember?' },
    { hanzi: '这个城市有三百多万人。', pinyin: 'Zhège chéngshì yǒu sānbǎi duō wàn rén.', english: 'This city has over three million people.' },
    { hanzi: '我的猫九岁多了。', pinyin: 'Wǒ de māo jiǔ suì duō le.', english: 'My cat is a bit over nine.' },
    { hanzi: '咖啡馆里热闹起来了。', pinyin: 'Kāfēiguǎn lǐ rènao qǐlai le.', english: 'The café is starting to get lively.' },
  ],
};

export const STRUCTURE_ONE_NOTE: NoteExercise = {
  type: 'note',
  title: '① 除了…还…',
  body: '① 除了 + 名词／动词短语 +（以外），主语 + 还 + 动词\n   Besides + Noun / Verb phrase + (apart from), Subject + also + Verb\n   → besides A, also B\n\nUsage\n除了 names the first thing; 还 adds one more of the same kind ("as well as"). 以外 is optional. 还 goes after the subject, right before the verb. Question form: 除了 A，你还…什么？ 除了咖啡，还喝茶 · 除了中文以外，还会法语\n(Compare 除了…都… = except: 除了他，大家都来了 = everyone came except him.)\n\nCommon mistake\n✗ 除了咖啡，还我喝茶。\n✓ 除了咖啡，我还喝茶。',
  sentences: [
    { hanzi: '除了中文，他还会说法语。', pinyin: 'Chúle Zhōngwén, tā hái huì shuō Fǎyǔ.', english: 'Besides Chinese, he can also speak French.' },
    { hanzi: '除了牛角包以外，我还买了两杯咖啡。', pinyin: 'Chúle niújiǎobāo yǐwài, wǒ hái mǎi le liǎng bēi kāfēi.', english: 'Apart from croissants, I also bought two coffees.' },
  ],
};

export const STRUCTURE_FOUR_NOTE: NoteExercise = {
  type: 'note',
  title: '④ 个位数 + 量词 + 多',
  body: '④ 个位数 + 量词 + 多 + 名词\n   Single digit + Measure word + more + Noun\n   → a bit over X\n\nUsage\nWith a single digit (1–9), 多 comes AFTER the measure word: 五块多 = 5.something yuan. Very common with 块, 岁, 个小时, 个月, 年, 斤, 公斤. 两个多小时 · 一年多\n\nBefore or after the measure word?\n二十多个人 → round 20: 多 before 个 (③)\n两个多小时 → single 2: 多 after 个 (④)\n\nCommon mistake\n✗ 三多岁\n✓ 三岁多',
  sentences: [
    { hanzi: '从这儿到机场要一个多小时。', pinyin: 'Cóng zhèr dào jīchǎng yào yí gè duō xiǎoshí.', english: 'It takes over an hour from here to the airport.' },
    { hanzi: '我学中文学了两年多了。', pinyin: 'Wǒ xué Zhōngwén xué le liǎng nián duō le.', english: "I've been learning Chinese for over two years." },
  ],
};

/** Notes the parser must leave alone (plain text, as before). */
export const PLAIN_NOTES: NoteExercise[] = [
  { type: 'note', title: 'At the hotel', body: "You're checking in at a hotel in Beijing.\n\n王府井 Wángfǔjǐng — a shopping street." },
  { type: 'note', body: '好 before a verb = easy to do. It describes the THING, so the thing is the subject.', sentences: [{ hanzi: '这个字好写。' }] },
  { type: 'note', body: 'Remember: 1 + 1 = 2, and 我 + 你 = 我们。' },
];
