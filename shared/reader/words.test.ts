import { describe, it, expect } from 'vitest';
import {
  alignReaderWords,
  fallbackReaderWords,
  isTappableWord,
  parseReaderWords,
  sentenceAround,
  wordOffsets,
  wordsMatchText,
} from './words';

const join = (w: Array<{ text: string }>) => w.map((x) => x.text).join('');

describe('alignReaderWords', () => {
  const page = '早上好。我叫小徐，我三十五岁。今天我坐火车去上班。';

  it('keeps a clean segmentation as it is, punctuation as its own segments', () => {
    const proposed = [
      { text: '早上', pinyin: 'zǎoshang', gloss: 'morning' },
      { text: '好', pinyin: 'hǎo', gloss: 'good' },
      { text: '。' },
      { text: '我', pinyin: 'wǒ', gloss: 'I' },
      { text: '叫', pinyin: 'jiào', gloss: 'am called' },
      { text: '小徐', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' },
      { text: '，' },
      { text: '我', pinyin: 'wǒ', gloss: 'I' },
      { text: '三十五', pinyin: 'sānshíwǔ', gloss: 'thirty-five' },
      { text: '岁', pinyin: 'suì', gloss: 'years old' },
      { text: '。' },
      { text: '今天', pinyin: 'jīntiān', gloss: 'today' },
      { text: '我', pinyin: 'wǒ', gloss: 'I' },
      { text: '坐', pinyin: 'zuò', gloss: 'take (a vehicle)' },
      { text: '火车', pinyin: 'huǒchē', gloss: 'train' },
      { text: '去', pinyin: 'qù', gloss: 'go' },
      { text: '上班', pinyin: 'shàngbān', gloss: 'go to work' },
      { text: '。' },
    ];
    const { words, coverage } = alignReaderWords(page, proposed);
    expect(join(words)).toBe(page);
    expect(coverage).toBe(1);
    expect(words.map((w) => w.text)).toEqual(proposed.map((p) => p.text));
    expect(words[2]).toEqual({ text: '。', pinyin: '', gloss: '' });
  });

  it('works when Claude leaves the punctuation out entirely', () => {
    const { words } = alignReaderWords(page, [
      { text: '早上', pinyin: 'zǎoshang', gloss: 'morning' },
      { text: '好', pinyin: 'hǎo', gloss: 'good' },
      { text: '我', pinyin: 'wǒ', gloss: 'I' },
    ]);
    expect(join(words)).toBe(page);
    expect(words[2].text).toBe('。');
    expect(words[3]).toMatchObject({ text: '我', gloss: 'I' });
    // the rest falls back to one hanzi per segment
    expect(words.slice(4, 6).map((w) => w.text)).toEqual(['叫', '小']);
  });

  it('splits punctuation stuck to a word off the chip', () => {
    const { words } = alignReaderWords('你好！', [{ text: '你好！', pinyin: 'nǐ hǎo', gloss: 'hello' }]);
    expect(words).toEqual([
      { text: '你好', pinyin: 'nǐ hǎo', gloss: 'hello' },
      { text: '！', pinyin: '', gloss: '' },
    ]);
  });

  it('keeps ASCII quotes and line breaks the model never returns', () => {
    const text = '小徐说："早上好！"\n吴先生笑了。';
    const { words, coverage } = alignReaderWords(text, [
      { text: '小徐', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' },
      { text: '说', pinyin: 'shuō', gloss: 'says' },
      { text: '早上好', pinyin: 'zǎoshang hǎo', gloss: 'good morning' },
      { text: '吴先生', pinyin: 'Wú xiānsheng', gloss: 'Mr Wu' },
      { text: '笑了', pinyin: 'xiào le', gloss: 'laughed' },
    ]);
    expect(join(words)).toBe(text);
    expect(coverage).toBe(1);
    expect(words.find((w) => w.text === '\n')).toBeTruthy();
    expect(words.filter((w) => isTappableWord(w.text)).map((w) => w.text)).toEqual(['小徐', '说', '早上好', '吴先生', '笑了']);
  });

  it('ignores invented or altered words and fills their stretch per character', () => {
    const text = '我喜欢猫。';
    const { words, coverage } = alignReaderWords(text, [
      { text: '我', pinyin: 'wǒ', gloss: 'I' },
      { text: '喜歡', pinyin: 'xǐhuan', gloss: 'like' }, // traditional — not in the text
      { text: '猫', pinyin: 'māo', gloss: 'cat' },
    ]);
    expect(join(words)).toBe(text);
    expect(words.map((w) => w.text)).toEqual(['我', '喜', '欢', '猫', '。']);
    expect(words[1].gloss).toBe('');
    expect(coverage).toBeCloseTo(0.5);
  });

  it('does not jump far ahead to a later repeat of a word', () => {
    const text = '他说今天很好，我也说好。';
    const { words } = alignReaderWords(text, [{ text: '我', pinyin: 'wǒ', gloss: 'I' }]);
    expect(join(words)).toBe(text);
    expect(words.find((w) => w.gloss === 'I')).toBeUndefined();
  });

  it('normalises tone-number pinyin and ignores junk entries', () => {
    const { words } = alignReaderWords('你好', [null as never, { text: 5 } as never, { text: '你好', pinyin: 'ni3 hao3', gloss: '  hello  ' }]);
    expect(words).toEqual([{ text: '你好', pinyin: 'nǐ hǎo', gloss: 'hello' }]);
  });

  it('holds the invariant for any proposal (fuzz)', () => {
    const texts = [page, '"我看看。"小徐说。"你的电脑很老了。"', 'A1 和 WiFi……好吗？\n好！', '「你好」'];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const text of texts) {
      for (let i = 0; i < 50; i++) {
        const chars = Array.from(text);
        const proposed: Array<{ text: string }> = [];
        let at = 0;
        while (at < chars.length) {
          const len = 1 + Math.floor(rand() * 3);
          let t = chars.slice(at, at + len).join('');
          if (rand() < 0.2) t = t + '错';
          if (rand() < 0.1) continue;
          proposed.push({ text: t });
          at += len;
        }
        expect(join(alignReaderWords(text, proposed).words)).toBe(text);
      }
    }
  });
});

describe('fallbackReaderWords', () => {
  it('one hanzi each; latin, punctuation and whitespace runs kept together', () => {
    expect(fallbackReaderWords('我有WiFi……\n好').map((w) => w.text)).toEqual(['我', '有', 'WiFi', '……', '\n', '好']);
  });
});

describe('parseReaderWords', () => {
  const words = [
    { text: '你好', pinyin: 'nǐ hǎo', gloss: 'hello' },
    { text: '。', pinyin: '', gloss: '' },
  ];
  it('accepts stored JSON that matches the page text', () => {
    expect(parseReaderWords(JSON.stringify(words), '你好。')).toEqual(words);
  });
  it('refuses stale words (the page was edited) and malformed values', () => {
    expect(parseReaderWords(JSON.stringify(words), '你好！')).toBeNull();
    expect(parseReaderWords('not json', '你好。')).toBeNull();
    expect(parseReaderWords(null, '你好。')).toBeNull();
    expect(parseReaderWords('[]', '')).toBeNull();
    expect(parseReaderWords([{ text: 1 }], '1')).toBeNull();
  });
  it('fills missing pinyin / gloss with empty strings', () => {
    expect(parseReaderWords([{ text: '好' }], '好')).toEqual([{ text: '好', pinyin: '', gloss: '' }]);
  });
});

describe('wordsMatchText / wordOffsets / isTappableWord', () => {
  it('match is exact', () => {
    expect(wordsMatchText([{ text: '你' }, { text: '好' }], '你好')).toBe(true);
    expect(wordsMatchText([{ text: '你' }], '你好')).toBe(false);
    expect(wordsMatchText([], '')).toBe(false);
  });
  it('offsets', () => {
    expect(wordOffsets([{ text: '早上' }, { text: '好' }, { text: '。' }])).toEqual([0, 2, 3]);
  });
  it('tappable = has a letter, digit or hanzi', () => {
    expect(isTappableWord('好')).toBe(true);
    expect(isTappableWord('35')).toBe(true);
    expect(isTappableWord('WiFi')).toBe(true);
    expect(isTappableWord('。')).toBe(false);
    expect(isTappableWord('……')).toBe(false);
    expect(isTappableWord('\n')).toBe(false);
    expect(isTappableWord('"')).toBe(false);
  });
});

describe('sentenceAround', () => {
  const text = '早上好。我叫小徐，我三十五岁。今天我坐火车去上班。';
  it('the sentence holding the word', () => {
    expect(sentenceAround(text, text.indexOf('小徐'), text.indexOf('小徐') + 2)).toBe('我叫小徐，我三十五岁。');
    expect(sentenceAround(text, 0, 2)).toBe('早上好。');
    expect(sentenceAround(text, text.indexOf('火车'))).toBe('今天我坐火车去上班。');
  });
  it('keeps a closing quote with its sentence and stops at line breaks', () => {
    const t = '"我看看。"小徐说。\n"你的电脑很老了。"';
    expect(sentenceAround(t, t.indexOf('看'))).toBe('"我看看。"');
    expect(sentenceAround(t, t.indexOf('小徐'))).toBe('小徐说。');
    expect(sentenceAround(t, t.indexOf('电脑'))).toBe('"你的电脑很老了。"');
  });
  it('a text without terminals is one sentence', () => {
    expect(sentenceAround('我们走吧', 2)).toBe('我们走吧');
  });
});
