import { describe, expect, it } from 'vitest';
import {
  readAloudDifferences,
  readAloudDifferenceAt,
  pinyinTone,
  toneName,
  readAloudAllRight,
  readAloudLocksPage,
  judgeReadAloud,
  readAloudBucket,
  readAloudCharLabel,
  readAloudHeardAnything,
  readAloudLine,
  readAloudNeedsLook,
  readAloudLegend,
  READ_ALOUD_LEGEND,
  readAloudTone,
  type ReadAloudResult,
} from './readAloud';

const marks = (r: ReadAloudResult) => r.chars.map((c) => `${c.char}:${c.mark}`).join(' ');
const markOf = (r: ReadAloudResult, ch: string) => r.chars.find((c) => c.char === ch)?.mark;

describe('judgeReadAloud', () => {
  it('reads the page exactly: every character ok, punctuation plain', () => {
    const r = judgeReadAloud('小明在巴黎。', '小明在巴黎');
    expect(marks(r)).toBe('小:ok 明:ok 在:ok 巴:ok 黎:ok 。:plain');
    expect(r).toMatchObject({ total: 5, right: 5, pct: 100, toCheck: 0, extraAtEnd: '' });
    expect(readAloudLine(r)).toBe('✓ 100% — all read right');
  });

  it('ignores punctuation, spaces and quotes on both sides', () => {
    const r = judgeReadAloud('他说：“你好！”', '他 说, 你好.');
    expect(r.pct).toBe(100);
    expect(r.chars.filter((c) => c.mark === 'plain').map((c) => c.char).join('')).toBe('：“！”');
  });

  it('a homophone counts as right (sound), in context', () => {
    const r = judgeReadAloud('他在游泳。', '她在游泳');
    expect(markOf(r, '他')).toBe('sound');
    expect(r.chars[0].heard).toBe('她');
    expect(r.pct).toBe(100);
    expect(r.toCheck).toBe(0);
  });

  it('the same syllable in another tone is close', () => {
    const r = judgeReadAloud('我想买书。', '我想卖书');
    expect(markOf(r, '买')).toBe('close');
    expect(r.chars.find((c) => c.char === '买')?.heard).toBe('卖');
    expect(r).toMatchObject({ right: 3, total: 4, pct: 75, toCheck: 1 });
    expect(readAloudLine(r)).toBe('≈ 75% — 1 to check');
  });

  it('another character is wrong', () => {
    const r = judgeReadAloud('我喜欢猫。', '我喜欢狗');
    expect(markOf(r, '猫')).toBe('wrong');
    expect(r.pct).toBe(75);
  });

  it('a missed character is missed; reading only part of the page misses the rest', () => {
    const r = judgeReadAloud('我今天很忙。', '我今天忙');
    expect(markOf(r, '很')).toBe('missed');
    expect(r.chars.find((c) => c.char === '很')?.heard).toBe('');
    const part = judgeReadAloud('小明在巴黎。他很开心。', '小明在巴黎');
    expect(part.chars.filter((c) => c.mark === 'missed').map((c) => c.char).join('')).toBe('他很开心');
    expect(part.pct).toBe(55);
  });

  it('extra words become a caret before the character they came before, or at the end', () => {
    const r = judgeReadAloud('我很好。', '我真的很好');
    expect(r.chars.find((c) => c.char === '很')?.extraBefore).toBe('真的');
    expect(r.pct).toBe(100);
    expect(r.toCheck).toBe(1);
    expect(readAloudLine(r)).toBe('✓ 100% — 1 to check');
    const end = judgeReadAloud('我很好。', '我很好啊');
    expect(end.extraAtEnd).toBe('啊');
  });

  it('numbers: digits and hanzi meet, and 两 = 二', () => {
    expect(judgeReadAloud('我有三本书。', '我有3本书').pct).toBe(100);
    expect(judgeReadAloud('我有两本书。', '我有2本书').pct).toBe(100);
    const digits = judgeReadAloud('现在12点。', '现在十二点');
    expect(digits.pct).toBe(100);
    expect(digits.total).toBe(4);
    expect(digits.chars.map((c) => c.mark)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'plain']);
    const off = judgeReadAloud('现在12点。', '现在十点');
    expect(off.chars[2].mark).toBe('wrong');
    expect(off.chars[3].mark).toBe('wrong');
  });

  it('traditional characters from the recogniser count as the simplified page', () => {
    expect(judgeReadAloud('我们说汉语。', '我們說漢語').pct).toBe(100);
  });

  it('a neutral syllable on the page matches any tone of the same syllable', () => {
    const r = judgeReadAloud('他长得很高。', '他长德很高');
    expect(markOf(r, '得')).toBe('sound');
  });

  it('handles a longer, two-sentence page and an empty take', () => {
    const page = '小明今天早上七点起床。他吃了早饭，然后去学校。';
    const r = judgeReadAloud(page, '小明今天早上7点起床他吃了早饭然后去学校');
    expect(r.pct).toBe(100);
    const none = judgeReadAloud(page, '');
    expect(none.pct).toBe(0);
    expect(none.chars.filter((c) => c.mark !== 'plain').every((c) => c.mark === 'missed')).toBe(true);
    expect(readAloudHeardAnything('。。 ')).toBe(false);
    expect(readAloudHeardAnything('好')).toBe(true);
  });

  it('marks and labels', () => {
    const r = judgeReadAloud('我想买书。', '我想卖书呀');
    expect(readAloudNeedsLook(r.chars.slice(0, 2))).toBe(false);
    expect(readAloudNeedsLook(r.chars.slice(2, 3))).toBe(true);
    expect(readAloudCharLabel(r.chars[2])).toBe('买 — tone off (heard 卖)');
    expect(readAloudCharLabel({ char: '很', mark: 'missed', heard: '', extraBefore: '真的' })).toBe('You also said 真的. 很 — missed');
  });
});

describe('the line, tone and bucket', () => {
  it('words and tiers', () => {
    expect(readAloudLine({ pct: 92, toCheck: 2 })).toBe('✓ 92% — 2 to check');
    expect(readAloudLine({ pct: 40, toCheck: 9 })).toBe('✕ 40% — 9 to check');
    expect(readAloudTone({ pct: 92, toCheck: 2 })).toBe('good');
    expect(readAloudTone({ pct: 70, toCheck: 2 })).toBe('some');
    expect(readAloudTone({ pct: 30, toCheck: 2 })).toBe('low');
    expect([100, 95, 80, 55, 10].map(readAloudBucket)).toEqual(['all', '90', '75', '50', 'under_50']);
  });
});

describe('the legend', () => {
  it('lists only the marks shown, in a fixed order', () => {
    expect(readAloudLegend(judgeReadAloud('早上好。我叫小徐。', '早上好。我叫小徐。'))).toEqual([]);
    // 她 = sound (no mark), 行 = tone off, 很 missed, 了 extra.
    expect(readAloudLegend(judgeReadAloud('小明今天第一次去巴黎。他很兴奋。', '小明今天第一次去巴黎了她行奋'))).toEqual(['close', 'missed', 'extra']);
    expect(readAloudLegend(judgeReadAloud('成都是四川的省会，人们都说这里是天府之国。', '成都是十船的省会了人们豆说这里是天国')))
      .toEqual(['close', 'wrong', 'missed', 'extra']);
    expect(readAloudLegend(judgeReadAloud('我想买书。', '我想买书呀'))).toEqual(['extra']);
    expect(READ_ALOUD_LEGEND.close).toBe('tone off');
  });
});

describe('all right (confetti) and the page lock', () => {
  it('all right = every character ok or a homophone, no extras, something to read', () => {
    expect(readAloudAllRight(judgeReadAloud('小明在巴黎。', '小明在巴黎'))).toBe(true);
    // A homophone the recogniser picked still counts as right.
    expect(readAloudAllRight(judgeReadAloud('他在游泳。', '她在游泳'))).toBe(true);
    expect(readAloudAllRight(judgeReadAloud('现在12点。', '现在十二点'))).toBe(true);
    // Tone off, wrong, missed: not all right.
    expect(readAloudAllRight(judgeReadAloud('我想买书。', '我想卖书'))).toBe(false);
    expect(readAloudAllRight(judgeReadAloud('现在12点。', '现在十点'))).toBe(false);
    expect(readAloudAllRight(judgeReadAloud('小明今天早上七点起床。他吃了早饭，然后去学校。', '小明今天早上起床'))).toBe(false);
    // 100% but with extra words said: not all right.
    const extra = judgeReadAloud('我想买书。', '我想买书呀');
    expect(extra.pct).toBe(100);
    expect(readAloudAllRight(extra)).toBe(false);
    // Nothing to read.
    expect(readAloudAllRight(judgeReadAloud('', '你好'))).toBe(false);
  });

  it('a take locks the page while recording and while it is checked', () => {
    expect(['idle', 'listening', 'finishing', 'failed', 'review'].map(readAloudLocksPage)).toEqual([false, true, true, false, false]);
  });
});

describe('the differences (what it heard vs what the page says)', () => {
  const CHENGDU = '胆子大的话，可以试试麻辣兔头，这是很多成都人最爱的小吃。';
  const CHENGDU_WORDS = ['胆子', '大', '的话', '，', '可以', '试试', '麻辣', '兔头', '，', '这', '是', '很多', '成都', '人', '最', '爱', '的', '小吃', '。'];

  it("Jerome's take: 成都 heard as 程度 — 成 a homophone (right), 都 the 4th tone instead of the 1st", () => {
    const r = judgeReadAloud(CHENGDU, '胆子大的话，可以试试麻辣兔头，这是很多程度人最爱的小吃。');
    expect(r.pct).toBe(96);
    expect(r.toCheck).toBe(1);
    const diffs = readAloudDifferences(r, CHENGDU_WORDS);
    expect(diffs).toEqual([{
      start: 19, end: 21, page: '成都', pagePinyin: 'chéngdū', heard: '程度', heardPinyin: 'chéngdù', kind: 'tone', toCheck: true,
      reasons: ['成 chéng — sounded right (written 程)', '都 dū → you said dù (4th tone instead of 1st)'],
    }]);
    // A tap on 成 or 都 finds that row; elsewhere nothing.
    expect(readAloudDifferenceAt(diffs, 19)).toBe(0);
    expect(readAloudDifferenceAt(diffs, 20)).toBe(0);
    expect(readAloudDifferenceAt(diffs, 3)).toBe(-1);
    // "You said" marks the transcript's own characters the same way.
    expect(r.heard!.filter((c) => c.mark !== 'ok' && c.mark !== 'plain')).toEqual([{ char: '程', mark: 'sound' }, { char: '度', mark: 'close' }]);
    // Without word chips the run of differing characters is the span.
    expect(readAloudDifferences(r).map((d) => d.page)).toEqual(['成都']);
  });

  it('a missed character, an extra word and another character', () => {
    const missed = readAloudDifferences(judgeReadAloud('我喜欢你的书。', '我喜欢你书'), ['我', '喜欢', '你', '的', '书', '。']);
    expect(missed).toEqual([{ start: 4, end: 5, page: '的', pagePinyin: 'de', heard: '', heardPinyin: '', kind: 'missed', toCheck: true, reasons: ['missed 的 de'] }]);

    const extra = judgeReadAloud('我想买书。', '我想买书了');
    expect(readAloudDifferences(extra)).toEqual([{ start: 5, end: 5, page: '', pagePinyin: '', heard: '了', heardPinyin: 'le', kind: 'extra', toCheck: true, reasons: ['extra 了 le'] }]);
    const extraBefore = readAloudDifferences(judgeReadAloud('我想买书。', '我真想买书'), ['我', '想', '买', '书', '。']);
    expect(extraBefore[0]).toMatchObject({ page: '想', heard: '真想', kind: 'extra', toCheck: true, reasons: ['extra 真 zhēn'] });

    const wrong = readAloudDifferences(judgeReadAloud('他喝了一杯咖啡。', '他喝了一杯可乐'), ['他', '喝', '了', '一', '杯', '咖啡', '。']);
    expect(wrong).toEqual([{
      start: 5, end: 7, page: '咖啡', pagePinyin: 'kāfēi', heard: '可乐', heardPinyin: 'kělè', kind: 'wrong', toCheck: true,
      reasons: ['咖 kā → you said 可 kě', '啡 fēi → you said 乐 lè'],
    }]);
  });

  it('a homophone-only word is listed but not to check; tones are named in words', () => {
    const r = judgeReadAloud('他在游泳。', '她在游泳');
    expect(r.toCheck).toBe(0);
    expect(readAloudDifferences(r, ['他', '在', '游泳', '。'])).toEqual([{
      start: 0, end: 1, page: '他', pagePinyin: 'tā', heard: '她', heardPinyin: 'tā', kind: 'sound', toCheck: false, reasons: ['他 tā — sounded right (written 她)'],
    }]);
    expect(readAloudDifferences(judgeReadAloud('早上好。', '早上好'))).toEqual([]);
    expect(['mā', 'má', 'mǎ', 'mà', 'ma', 'lǜ'].map(pinyinTone)).toEqual([1, 2, 3, 4, 0, 4]);
    expect([0, 1, 2, 3, 4].map(toneName)).toEqual(['neutral', '1st', '2nd', '3rd', '4th']);
    // Words that don't line up with the page are ignored (runs instead).
    expect(readAloudDifferences(judgeReadAloud('他在游泳。', '她在游泳'), ['别的']).map((d) => d.page)).toEqual(['他']);
  });

  it('a digit run is one unit in the reasons', () => {
    const d = readAloudDifferences(judgeReadAloud('现在12点。', '现在十点'));
    expect(d).toHaveLength(1);
    expect(d[0].page).toBe('12');
    expect(d[0].kind).toBe('wrong');
    expect(d[0].reasons).toHaveLength(1);
    expect(d[0].reasons[0].startsWith('12 ')).toBe(true);
  });
});
