import { describe, expect, it } from 'vitest';
import {
  judgeReadAloud,
  readAloudBucket,
  readAloudCharLabel,
  readAloudHeardAnything,
  readAloudLine,
  readAloudNeedsLook,
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
