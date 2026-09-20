import { describe, it, expect } from 'vitest';
import { parseWordList, classifyCell, normalizeHanzi } from './parse';

const brief = (r: { hanzi: string; pinyin: string; english: string; sentence: string; notes: string }) =>
  [r.hanzi, r.pinyin, r.english, r.sentence, r.notes];

describe('parseWordList — separators', () => {
  it('parses a tab-separated spreadsheet paste', () => {
    const res = parseWordList('苹果\tpíngguǒ\tapple\n香蕉\txiāngjiāo\tbanana\n');
    expect(res.detected.columnSeparator).toBe('tab');
    expect(res.detected.columns).toEqual(['hanzi', 'pinyin', 'english']);
    expect(res.rows.map(brief)).toEqual([
      ['苹果', 'píngguǒ', 'apple', '', ''],
      ['香蕉', 'xiāngjiāo', 'banana', '', ''],
    ]);
  });

  it('drops a header row and keeps a fourth Han column as the sentence', () => {
    const res = parseWordList('Chinese\tPinyin\tEnglish\tSentence\n苹果\tpíng guǒ\tapple\t我每天吃一个苹果。');
    expect(res.detected.headerDropped).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].sentence).toBe('我每天吃一个苹果。');
  });

  it('handles commas, Chinese commas and English that contains a comma', () => {
    const res = parseWordList('苹果，píngguǒ，apple\n香蕉, xiāngjiāo, banana\n');
    expect(res.detected.columnSeparator).toBe('comma');
    expect(res.rows.map(r => r.english)).toEqual(['apple', 'banana']);
  });

  it('handles "hanzi - english" and "hanzi：english" lines', () => {
    const res = parseWordList('苹果 - apple\n香蕉：banana\n葡萄: grape');
    expect(res.detected.columnSeparator).toBe('colon');
    expect(res.rows.map(r => [r.hanzi, r.english])).toEqual([['苹果', 'apple'], ['香蕉', 'banana'], ['葡萄', 'grape']]);
  });

  it('splits space-separated WeChat-style lines at script boundaries', () => {
    const res = parseWordList('苹果 píngguǒ apple\n香蕉 xiāng jiāo banana\n葡萄 grape\n西瓜 (xī guā) watermelon, a big one');
    expect(res.detected.columnSeparator).toBe('space');
    expect(res.rows.map(brief)).toEqual([
      ['苹果', 'píngguǒ', 'apple', '', ''],
      ['香蕉', 'xiāng jiāo', 'banana', '', ''],
      ['葡萄', '', 'grape', '', ''],
      ['西瓜', 'xī guā', 'watermelon, a big one', '', ''],
    ]);
  });

  it('treats toneless English that happens to be syllables as English', () => {
    const res = parseWordList('妈妈 mother\n安 an\n');
    expect(res.rows[0].pinyin).toBe('');
    expect(res.rows[0].english).toBe('mother');
    // "an" for a one-character word IS accepted as toneless pinyin (length matches)
    expect(res.rows[1].pinyin).toBe('an');
  });

  it('accepts hanzi-only lines and bullets / numbering', () => {
    const res = parseWordList('1. 苹果\n2、香蕉\n- 葡萄\n• 西瓜');
    expect(res.rows.map(r => r.hanzi)).toEqual(['苹果', '香蕉', '葡萄', '西瓜']);
    expect(res.rows.every(r => r.pinyin === '' && r.english === '')).toBe(true);
  });

  it('splits a single line on semicolons', () => {
    const res = parseWordList('苹果 apple; 香蕉 banana; 葡萄 grape');
    expect(res.detected.rowSeparator).toBe('semicolon');
    expect(res.rows.map(r => r.hanzi)).toEqual(['苹果', '香蕉', '葡萄']);
  });

  it('converts tone numbers in pinyin cells', () => {
    const res = parseWordList('苹果\tping2guo3\tapple');
    expect(res.rows[0].pinyin).toBe('píngguǒ');
  });

  it('votes column roles so an English-first spreadsheet works', () => {
    const res = parseWordList('apple\t苹果\tpíngguǒ\nbanana\t香蕉\txiāngjiāo');
    expect(res.detected.columns).toEqual(['english', 'hanzi', 'pinyin']);
    expect(res.rows[1].english).toBe('banana');
  });

  it('flags lines without Chinese and duplicates within the paste', () => {
    const res = parseWordList('苹果\tpíngguǒ\tapple\nhello\tworld\tagain\n苹果\tpíng guǒ\tapple (fruit)');
    expect(res.rows[1].problems).toEqual(['no_chinese']);
    expect(res.rows[0].problems).toEqual(['duplicate_in_paste']);
    expect(res.rows[2].problems).toEqual([]);
  });

  it('honours separator overrides', () => {
    const res = parseWordList('苹果|apple', { columnSeparator: 'pipe' });
    expect(res.rows[0].english).toBe('apple');
    const custom = parseWordList('苹果 => apple', { columnSeparator: 'custom', customSeparator: '=>' });
    expect(custom.rows[0].english).toBe('apple');
  });

  it('ignores empty input', () => {
    expect(parseWordList('   \n\n').rows).toEqual([]);
  });
});

describe('classifyCell / normalizeHanzi', () => {
  it('classifies by script', () => {
    expect(classifyCell('苹果')).toBe('hanzi');
    expect(classifyCell('píngguǒ')).toBe('pinyin');
    expect(classifyCell('ping2 guo3')).toBe('pinyin');
    expect(classifyCell('apple')).toBe('english');
    expect(classifyCell('ping guo', 2)).toBe('pinyin');
    expect(classifyCell('ping guo')).toBe('english');
    expect(classifyCell('')).toBe('ignore');
  });
  it('normalises hanzi for matching', () => {
    expect(normalizeHanzi(' 苹 果。')).toBe('苹果');
  });
});
