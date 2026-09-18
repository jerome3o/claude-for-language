import { describe, it, expect } from 'vitest';
import { validateReaderSpec, normalizeReaderSpec } from './validate';
import type { ReaderSpec } from './types';

const good: ReaderSpec = {
  title_chinese: '长春的冬天',
  title_english: 'Winter in Changchun',
  difficulty_level: 'beginner',
  topic: 'winter',
  pages: [
    { id: 'p1', content_chinese: '今天很冷。', content_pinyin: 'jīn tiān hěn lěng.', content_english: 'It is very cold today.', image_prompt: 'snowy street' },
    { content_chinese: '我穿了大衣。', content_pinyin: '', content_english: 'I put on a coat.' },
  ],
};

describe('validateReaderSpec', () => {
  it('accepts a valid spec (pinyin may be blank, ids optional)', () => {
    expect(validateReaderSpec(good)).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateReaderSpec(null)).toEqual(['Reader spec must be an object']);
    expect(validateReaderSpec('x')).toEqual(['Reader spec must be an object']);
  });

  it('requires both titles and a known difficulty', () => {
    const errors = validateReaderSpec({ ...good, title_chinese: ' ', title_english: '', difficulty_level: 'hard' });
    expect(errors).toContain('title_chinese is required');
    expect(errors).toContain('title_english is required');
    expect(errors.some(e => e.startsWith('difficulty_level must be one of'))).toBe(true);
  });

  it('requires at least one page with Chinese and English', () => {
    expect(validateReaderSpec({ ...good, pages: [] })).toContain('A reader needs at least one page');
    const errors = validateReaderSpec({ ...good, pages: [{ content_chinese: '', content_pinyin: '', content_english: '' }] });
    expect(errors).toContain('Page 1: Chinese text is required');
    expect(errors).toContain('Page 1: English translation is required');
  });

  it('rejects duplicate page ids and bad field types', () => {
    const errors = validateReaderSpec({
      ...good,
      pages: [
        { id: 'a', content_chinese: '一', content_pinyin: 'yī', content_english: 'one' },
        { id: 'a', content_chinese: '二', content_pinyin: 3, content_english: 'two', image_prompt: 5 },
      ],
    });
    expect(errors).toContain('Page 2: duplicate page id "a"');
    expect(errors).toContain('Page 2: content_pinyin must be a string');
    expect(errors).toContain('Page 2: image_prompt must be a string or null');
  });

  it('pages must be an array', () => {
    expect(validateReaderSpec({ ...good, pages: 'no' })).toEqual(['pages must be an array']);
  });
});

describe('normalizeReaderSpec', () => {
  it('trims strings and nulls blank optionals, keeping ids and image_url', () => {
    const n = normalizeReaderSpec({
      ...good,
      topic: '  ',
      pages: [{ id: 'p1', content_chinese: ' 你好 ', content_pinyin: ' nǐ hǎo ', content_english: ' hi ', image_prompt: '  ', image_url: 'k.png' }],
    });
    expect(n.topic).toBeNull();
    expect(n.pages[0]).toEqual({ id: 'p1', content_chinese: '你好', content_pinyin: 'nǐ hǎo', content_english: 'hi', image_prompt: null, image_url: 'k.png' });
    expect(n.vocabulary_used).toEqual([]);
  });
});
