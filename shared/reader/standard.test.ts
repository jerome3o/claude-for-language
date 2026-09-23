import { describe, it, expect } from 'vitest';
import { countSentences, readerPageWarnings, READER_STANDARD } from './standard';

describe('reader page standard', () => {
  it('counts sentences by terminal punctuation, quotes included', () => {
    expect(countSentences('小明上个月搬到了巴黎。他还在适应新的生活。')).toBe(2);
    expect(countSentences('有一天，朋友问他："法国的蜗牛很有名，你吃过吗？"小明说："还没有。"')).toBe(2);
    expect(countSentences('还不错！可是太多了，我吃不了。你呢？')).toBe(3);
    expect(countSentences('他很高兴')).toBe(1);
    expect(countSentences('')).toBe(0);
  });

  it('the Paris reader passes: 1–3 sentences, under 45 characters, one paragraph', () => {
    const spec = {
      difficulty_level: 'elementary',
      pages: [
        { content_chinese: '小明上个月搬到了巴黎。他还在适应新的生活。' },
        { content_chinese: '他早上起得很早，五点就起床了。下午三四点，他没有精力，基本上每天都要睡午觉。' },
        { content_chinese: '吃完饭，他们去了商店。一个新手机打八折，可是小明还是买不起。朋友说："好可怜！"' },
      ],
    };
    expect(readerPageWarnings(spec)).toEqual([]);
  });

  it('flags the boat reader: many lines of dialogue on one page', () => {
    const spec = {
      difficulty_level: 'beginner',
      pages: [
        { content_chinese: '早上五点，小赵坐在一条很小的船上。她不是来看风景的，她是来开会的。\n她的公司在伦敦，她在湖上。船是老吴的。\n"老吴，这儿有网吗？"\n"有。靠桥的地方信号好。"' },
        { content_chinese: '船靠了岸。' },
      ],
    };
    const w = readerPageWarnings(spec);
    expect(w).toHaveLength(1);
    expect(w[0].page).toBe(1);
    expect(w[0].message).toMatch(/sentences/);
    expect(w[0].message).toMatch(/characters/);
    expect(w[0].message).toMatch(/line breaks/);
    expect(w[0].message).toMatch(/split/);
  });

  it('caps depend on the level', () => {
    const text = '他们去了一家饭馆。菜单上有蜗牛、牛排和腌肉。朋友点了十二个蜗牛和一个很大的牛排，还有很多面包、一瓶红酒和两杯咖啡。';
    expect(readerPageWarnings({ difficulty_level: 'beginner', pages: [{ content_chinese: text }] })).toHaveLength(1);
    expect(readerPageWarnings({ difficulty_level: 'intermediate', pages: [{ content_chinese: text }] })).toEqual([]);
  });

  it('the standard says what the checker enforces', () => {
    expect(READER_STANDARD).toContain('1–2 sentences');
    expect(READER_STANDARD).toContain('one exchange');
  });
});
