/**
 * Golden vectors for the Kotlin port of shared/cards/word-tags.ts (core/…/cards/WordTags.kt),
 * over the SHIPPED lexicon (shared/data/word-tags/word-tags.txt) and frequency list — the same
 * files the Lab app reads as core resources. Per input: the lookup key, the tags with and without
 * a frequency rank, with an exclude, and every tag's explanation; plus the marker scan, the
 * labels and a few parsed entries. Writes word-tags.json; checked by WordTagsParityTest.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFrequencyList } from '../../../shared/decks/frequency';
import { hskLabel, hskLevel, markerRegister, parseWordTagLexicon, wordTagExplanation, wordTagKey, wordTags } from '../../../shared/cards/word-tags';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
// The repo root above the output dir (android-lab/core/build/parity), as parity/fixtures/segment.ts does.
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, 'android-lab', 'parity'))) throw new Error(`repo root not found above ${OUT}`);
const lexicon = parseWordTagLexicon(readFileSync(join(root, 'shared/data/word-tags/word-tags.txt'), 'utf8'));
const freq = parseFrequencyList(readFileSync(join(root, 'shared/data/frequency/word-freq.txt'), 'utf8'));

const INPUTS = [
  // words of every kind
  '书', '银行', '电脑', '老师', '学习', '喜欢', '知道', '漂亮', '高兴', '非常', '已经', '个', '张', '本', '水', '我', '他们',
  '什么', '怎么', '在', '被', '把', '因为', '但是', '了', '吗', '的', '地', '着', '和', '哈哈', '一', '第一', '今天', '上面',
  '中国', '北京', '画蛇添足', '一路平安', '马马虎虎', '研究', '工作', '睡觉', '见面', '帮忙', '毕业', '洗澡', '生气', '担心',
  '您', '请问', '贵姓', '光临', '予以', '之', '老婆', '要是', '啥', '咋', '哥们', '屌丝', '他妈的', '网路', '牛', '机场', '派',
  '长得', '朋友', '行', '长', '得', '奶奶', '逝世', '开玩笑', '欢迎光临',
  // phrases, sentences, edge cases
  '喝咖啡', '喝咖啡吧', '您贵姓', '您贵姓？', '请问，银行在哪儿？', '请坐。', '来，请喝茶。', '我想申请签证。', '他邀请我。',
  '你干嘛呢？', '我今天很忙。', ' 你好！ ', '“书”', '（书）', '书。', '书\n', '书　', ' 您 ', '！', '', '   ',
  'hello', 'A4纸', '守株待兔', '画蛇添足。', '一二三四五六七', '多此一举', '咱们走吧', '哥们儿，干嘛去？', '他妈的！',
  '請問', '書', 'ｈｉ', '老婆和老公', '没事儿', '谢谢您',
  // HSK words the written-text list ranks rare (never "Rare"), and non-HSK ones that stay rare
  '一块儿', '一下儿', '一举', '拎', '结账', '买单', '银子',
];

const rankOf = (key: string): number | null => ([...key].length === 1 ? freq.chars.get(key) : freq.words.get(key)) ?? null;

const cases = INPUTS.map((hanzi) => {
  const key = wordTagKey(hanzi);
  const rank = rankOf(key);
  const withRank = wordTags(hanzi, lexicon, { rank });
  return {
    hanzi,
    key,
    rank,
    tags: wordTags(hanzi, lexicon),
    with_rank: withRank,
    rare: wordTags(hanzi, lexicon, { rank: null }),
    excluded: wordTags(hanzi, lexicon, { rank, exclude: ['frequency', 'trad', 'pos'] }),
    explanations: withRank.map((t) => wordTagExplanation(t, hanzi, lexicon)),
  };
});

const ENTRY_WORDS = ['书', '睡觉', '您', '研究', '光临', '朋友', '画蛇添足', '长得', '一'];
const out = {
  word_count: lexicon.words.size,
  markers: lexicon.markers,
  entries: ENTRY_WORDS.map((w) => ({ hanzi: w, entry: lexicon.words.get(w) ?? null })),
  hsk_labels: [1, 2, 6, 7].map((n) => [n, hskLabel(n)]),
  hsk_levels: ['书', '一块儿', ' 画蛇添足。', '拎', '结账', '', 'hello'].map((text) => ({ text, level: hskLevel(lexicon, text) })),
  ranks: [1, 100, 101, 1000, 1500, 2000, 2001, 3500, 3501, 10000, 10001].flatMap((rank) =>
    ['的', '书', '银行'].map((hanzi) => ({ hanzi, rank, tags: wordTags(hanzi, lexicon, { rank }) })),
  ),
  marker_scans: ['请坐', '申请请', '，请', '您好，请问', '啥咋俺', '', '请'].map((text) => ({ text, codes: markerRegister(text, lexicon.markers) })),
  no_lexicon: wordTags('书', null),
  cases,
};

writeFileSync(join(OUT, 'word-tags.json'), JSON.stringify(out, null, 1));
