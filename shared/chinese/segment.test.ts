import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrequencyList } from '../decks/frequency';
import { wordsMatchText } from '../reader/words';
import {
  buildSegmentDictionary,
  buildSegmentWords,
  COMPOUND_EXTRA,
  parseSegmentWords,
  rankCost,
  ruleCandidates,
  segmentChinese,
  segmentHanRun,
  segmentTexts,
  textRuns,
  UNKNOWN_CHAR_RANK,
  WORD_COST_BASE,
} from './segment';

const data = join(__dirname, '../data/frequency');
const real = buildSegmentDictionary(
  parseFrequencyList(readFileSync(join(data, 'word-freq.txt'), 'utf8')).words,
  parseSegmentWords(readFileSync(join(data, 'segment-words.txt'), 'utf8')),
);
const seg = (text: string) => segmentTexts(text, real).join('|');

/** A tiny dictionary: word → rank. */
function tiny(words: Record<string, number>) {
  return buildSegmentDictionary(new Map(Object.entries(words)));
}

describe('rankCost', () => {
  it('is the base plus 1000·ln(rank), rounded', () => {
    expect(rankCost(1)).toBe(WORD_COST_BASE);
    expect(rankCost(1000)).toBe(WORD_COST_BASE + 6908);
    expect(rankCost(0)).toBe(WORD_COST_BASE);
  });
});

describe('the DP over the DAG', () => {
  it('takes the most probable path', () => {
    const d = tiny({ 我: 5, 们: 9000, 我们: 20, 喜欢: 300, 喜: 4000, 欢: 9000 });
    expect(segmentHanRun('我们喜欢', d)).toEqual(['我们', '喜欢']);
  });

  it('prefers two common words over one rare word when that is cheaper', () => {
    const d = tiny({ 中国: 30, 人: 9, 中国人: 50_000 });
    expect(segmentHanRun('中国人', d)).toEqual(['中国', '人']);
    const d2 = tiny({ 中国: 30, 人: 9, 中国人: 200 });
    expect(segmentHanRun('中国人', d2)).toEqual(['中国人']);
  });

  it('splits unknown characters one by one', () => {
    expect(segmentHanRun('龘靐', tiny({ 我: 1 }))).toEqual(['龘', '靐']);
    expect(segmentHanRun('我龘', tiny({ 我: 1 }))).toEqual(['我', '龘']);
  });

  it('breaks equal costs towards the longer word', () => {
    // ab = rank e^x such that cost(ab) = cost(a) + cost(b): both 1 → base + 0 each; ab rank 1 → base.
    const d = buildSegmentDictionary(new Map([['甲', 1], ['乙', 1]]));
    const withPair = { costs: new Map([...d.costs, ['甲乙', 2 * WORD_COST_BASE]]), maxLength: 2 };
    expect(segmentHanRun('甲乙', withPair)).toEqual(['甲乙']);
  });

  it('gives jieba compounds (list words that are not headwords) an extra cost', () => {
    const listed = new Map([['这', 13], ['是', 2], ['这是', 282]]);
    const plain = buildSegmentDictionary(listed);
    expect(segmentHanRun('这是', plain)).toEqual(['这是']);
    const withCompounds = buildSegmentDictionary(listed, { ranked: new Map(), compounds: new Set(['这是']) });
    expect(withCompounds.costs.get('这是')).toBe(rankCost(282) + COMPOUND_EXTRA);
    expect(segmentHanRun('这是', withCompounds)).toEqual(['这', '是']);
  });

  it('an empty run has no words', () => {
    expect(segmentHanRun('', real)).toEqual([]);
  });
});

describe('rules', () => {
  const d = tiny({ 三: 300, 本: 150, 书: 400, 看: 50, 高兴: 600, 高: 100, 兴: 3000, 去: 60, 一: 30, 不: 10 });

  it('numbers with a measure word', () => {
    expect(segmentHanRun('三本书', d)).toEqual(['三本', '书']);
    expect(seg('今天是十二月二十五号。')).toBe('今天|是|十二月|二十五号|。');
    expect(seg('这是我第一次来北京。')).toBe('这|是|我|第一次|来|北京|。');
    expect(seg('我买了三本书和两个苹果。')).toBe('我|买|了|三本|书|和|两个|苹果|。');
  });

  it('reduplication: AA, AABB, A一A, A不A', () => {
    expect(segmentHanRun('看看', d)).toEqual(['看看']);
    expect(segmentHanRun('高高兴兴', d)).toEqual(['高高兴兴']);
    expect(segmentHanRun('看一看', d)).toEqual(['看一看']);
    expect(segmentHanRun('去不去', d)).toEqual(['去不去']);
    expect(seg('你慢慢说，我听听。')).toBe('你|慢慢|说|，|我|听听|。');
  });

  it('a word + 儿, but never at the cost of a word starting with 儿', () => {
    expect(seg('我们一边吃饭一边聊天儿吧。')).toBe('我们|一边|吃饭|一边|聊天儿|吧|。');
    expect(seg('他儿子很可爱。')).toBe('他|儿子|很|可爱|。');
  });

  it('A不A is not taken out of a repeated pair', () => {
    expect(seg('不用不用，我们AA吧。')).toBe('不用|不用|，|我们|AA|吧|。');
  });

  it('never doubles function words', () => {
    expect(ruleCandidates(Array.from('的的'), 0, d)).toEqual([]);
    expect(segmentHanRun('了了', tiny({ 了: 4 }))).toEqual(['了', '了']);
    expect(segmentHanRun('一不一', d)).not.toContain('一不一');
  });
});

describe('segmentChinese', () => {
  it('keeps punctuation, Latin, digits, spaces and line breaks as their own segments', () => {
    const text = '我用WiFi上网，30块钱。\n  好！';
    const words = segmentChinese(text, real);
    expect(words.map((w) => w.text)).toEqual(['我', '用', 'WiFi', '上网', '，', '30', '块钱', '。\n  ', '好', '！']
      .flatMap((t) => (t === '。\n  ' ? ['。', '\n  '] : [t])));
    expect(words.every((w) => w.gloss === '')).toBe(true);
  });

  it('runs are grouped like fallbackReaderWords', () => {
    expect(textRuns('a1，。 \n好').map((r) => [r.kind, r.text])).toEqual([
      ['latin', 'a1'], ['punct', '，。'], ['space', ' \n'], ['han', '好'],
    ]);
  });

  it('gives each word its syllables of the run pinyin, joined', () => {
    const words = segmentChinese('我们去银行。', real, { pinyinOf: (run) => (run === '我们去银行' ? 'wǒ men qù yín háng' : '') });
    expect(words).toEqual([
      { text: '我们', pinyin: 'wǒmen', gloss: '' },
      { text: '去', pinyin: 'qù', gloss: '' },
      { text: '银行', pinyin: 'yínháng', gloss: '' },
      { text: '。', pinyin: '', gloss: '' },
    ]);
  });

  it('leaves pinyin empty when the syllables do not line up or the pinyin throws', () => {
    expect(segmentChinese('我们', real, { pinyinOf: () => 'wǒ' })[0].pinyin).toBe('');
    expect(segmentChinese('我们', real, { pinyinOf: () => { throw new Error('x'); } })[0].pinyin).toBe('');
  });

  it('keeps the concatenation invariant on awkward input', () => {
    const texts = [
      '', ' ', '\n\n', '？！', 'hello', '𠀀𠀁好', '「没想」是说过去的事，意思是"以前没有想过"。', '一，二，三',
      '好问题！\n\n「工资高」的相反是「工资低」。\n\n1. 这份工作的工资低。', '😀我😀', '第', '第十二个', '一一一一一一一一一一一',
    ];
    for (const t of texts) {
      const words = segmentChinese(t, real);
      expect(words.map((w) => w.text).join('')).toBe(t);
      if (t) expect(wordsMatchText(words, t)).toBe(true);
      expect(words.every((w) => w.text.length > 0)).toBe(true);
    }
  });
});

describe('the corpus', () => {
  const corpus = readFileSync(join(__dirname, '__fixtures__/corpus.txt'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/\\n/g, '\n'));

  it('has a few hundred texts, every one segmented back to itself', () => {
    expect(corpus.length).toBeGreaterThan(400);
    for (const text of corpus) expect(segmentTexts(text, real).join('')).toBe(text);
  });

  it('makes words, not characters: most Han characters sit in multi-character chips', () => {
    let han = 0;
    let inWords = 0;
    for (const text of corpus) {
      for (const w of segmentTexts(text, real)) {
        const n = Array.from(w).filter((ch) => /\p{Script=Han}/u.test(ch)).length;
        han += n;
        if (n >= 2) inWords += n;
      }
    }
    expect(inWords / han).toBeGreaterThan(0.5);
  });
});

describe('the shipped lists', () => {
  it('parse into one dictionary', () => {
    expect(real.costs.size).toBeGreaterThan(60_000);
    expect(real.maxLength).toBeLessThanOrEqual(8);
    expect(real.costs.get('银行')).toBe(rankCost(570));
  });

  it('the segment-words file round-trips', () => {
    const headwords = new Map([['银行', 570], ['中国人', 50_432], ['搞混', 34_790], ['火车站', 4731]]);
    const listed = new Map([['银行', 1], ['这是', 2], ['我', 3]]);
    const text = buildSegmentWords(headwords, listed, ['test']);
    expect(text).toBe('# test\n#ranked\n火车站\t4731\n搞混\t30059\n中国人\t15642\n#compounds\n这是\n');
    const parsed = parseSegmentWords(text);
    expect([...parsed.ranked]).toEqual([['火车站', 4731], ['搞混', 34_790], ['中国人', 50_432]]);
    expect([...parsed.compounds]).toEqual(['这是']);
  });

  it('an unknown Han character is expensive', () => {
    expect(rankCost(UNKNOWN_CHAR_RANK)).toBeGreaterThan(rankCost(30_000));
  });
});

/** Hand-picked sentences: Ask Claude replies, chat lines, reader pages. */
const GOLDEN: Array<[string, string]> = [
  ['我们明天去银行取钱', '我们|明天|去|银行|取|钱'],
  ['他是中国人', '他|是|中国|人'],
  ['好问题！这两个很容易搞混。', '好|问题|！|这|两个|很|容易|搞混|。'],
  ['比如：我没想到你会来！', '比如|：|我|没想到|你|会|来|！'],
  ['「不想」是说现在的感觉，意思是"不愿意"。', '「|不想|」|是|说|现在|的|感觉|，|意思|是|"|不|愿意|"。'],
  ['「老百姓」里的「百」是「一百」的百', '「|老百姓|」|里|的|「|百|」|是|「|一百|」|的|百'],
  ['古代中国有很多姓，比如李、王、张、刘。', '古代|中国|有|很多|姓|，|比如|李|、|王|、|张|、|刘|。'],
  ['这份工作的工资低，我不想做。', '这份|工作|的|工资|低|，|我|不想|做|。'],
  ['他的工资低，所以他想换工作。', '他|的|工资|低|，|所以|他|想|换|工作|。'],
  ['我们去看一看吧。', '我们|去|看一看|吧|。'],
  ['你去不去学校？', '你|去不去|学校|？'],
  ['他高高兴兴地回家了。', '他|高高兴兴|地|回家|了|。'],
  ['结婚的和尚未结婚的', '结婚|的|和|尚未|结婚|的'],
  ['我想学习汉语，因为我对中国文化很感兴趣。', '我|想|学习|汉语|，|因为|我|对|中国|文化|很|感兴趣|。'],
  ['研究生命的起源', '研究|生命|的|起源'],
  ['我在图书馆看书，然后去火车站接朋友。', '我|在|图书馆|看书|，|然后|去|火车站|接|朋友|。'],
  ['你昨天晚上休息得怎么样？', '你|昨天晚上|休息|得|怎么样|？'],
  ['小明在巴黎', '小明|在|巴黎'],
  ['这个词的相反是什么', '这个|词|的|相反|是|什么'],
  ['为什么这个词有百的字', '为什么|这个|词|有|百|的|字'],
  ['没想和不想有什么区别', '没|想|和|不想|有|什么|区别'],
  ['早上好。我叫小徐，我三十五岁。', '早上好|。|我|叫|小|徐|，|我|三十五岁|。'],
  ['今天我坐火车去上班。', '今天|我|坐|火车|去|上班|。'],
  ['吴先生进了科技商店。', '吴|先生|进|了|科技|商店|。'],
  ['我的移动硬盘坏了。', '我|的|移动硬盘|坏|了|。'],
  ['你的电脑硬件很老了。', '你|的|电脑|硬件|很|老|了|。'],
  ['谢谢你的帮助，我明白了。', '谢谢|你|的|帮助|，|我|明白|了|。'],
  ['周末你有空吗？我们一起去吃饭吧。', '周末|你|有空|吗|？|我们|一起|去|吃饭|吧|。'],
  ['这个字的意思是"很多"。', '这个|字|的|意思|是|"|很多|"。'],
  ['你要不要我帮你加一张卡片？', '你|要不要|我|帮|你|加|一张|卡片|？'],
];

describe('golden sentences', () => {
  for (const [text, expected] of GOLDEN) {
    it(text, () => {
      expect(seg(text)).toBe(expected);
    });
  }
});

describe('speed', () => {
  it('segments a long Ask Claude reply in a few milliseconds', () => {
    const reply = GOLDEN.map(([t]) => t).join('\n');
    segmentTexts(reply, real); // warm up
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) segmentTexts(reply, real);
    const perReply = (performance.now() - t0) / runs;
    expect(reply.length).toBeGreaterThan(300);
    expect(perReply).toBeLessThan(15);
  });
});
