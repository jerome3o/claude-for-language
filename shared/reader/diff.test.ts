import { describe, it, expect } from 'vitest';
import { diffReaderSpecs, formatReaderDiff } from './diff';
import type { ReaderSpec } from './types';

function spec(over: Partial<ReaderSpec> = {}): ReaderSpec {
  return {
    title_chinese: '长春的冬天',
    title_english: 'Winter in Changchun',
    difficulty_level: 'beginner',
    topic: 'winter',
    pages: [
      { id: 'p1', content_chinese: '长春的冬天很冷。', content_pinyin: 'Chángchūn de dōngtiān hěn lěng.', content_english: 'Winter in Changchun is very cold.', image_prompt: 'snowy city' },
      { id: 'p2', content_chinese: '我每天穿大衣。', content_pinyin: 'wǒ měitiān chuān dàyī.', content_english: 'I wear a coat every day.', image_prompt: null },
      { id: 'p3', content_chinese: '晚上我喝热茶。', content_pinyin: 'wǎnshang wǒ hē rè chá.', content_english: 'In the evening I drink hot tea.', image_prompt: 'tea' },
    ],
    ...over,
  };
}

describe('diffReaderSpecs', () => {
  it('reports no change for identical specs', () => {
    const d = diffReaderSpecs(spec(), spec());
    expect(d.changed).toBe(false);
    expect(formatReaderDiff(d)).toEqual([]);
  });

  it('reports meta changes with labels', () => {
    const d = diffReaderSpecs(spec(), spec({ title_english: 'Changchun Winter', difficulty_level: 'elementary', topic: null }));
    expect(d.meta.map(m => m.field)).toEqual(['title_english', 'difficulty_level', 'topic']);
    expect(formatReaderDiff(d)[0]).toBe('English title: "Winter in Changchun" → "Changchun Winter"');
  });

  it('matches pages by id and lists changed fields', () => {
    const after = spec();
    after.pages[1] = { ...after.pages[1], content_chinese: '我每天都穿大衣。', image_prompt: 'a person in a coat' };
    const d = diffReaderSpecs(spec(), after);
    expect(d.pages).toHaveLength(1);
    const e = d.pages[0];
    expect(e.kind).toBe('changed');
    if (e.kind === 'changed') {
      expect(e.index).toBe(1);
      expect(e.fields.map(f => f.field)).toEqual(['content_chinese', 'image_prompt']);
    }
    expect(formatReaderDiff(d)[0]).toMatch(/^Page 2: changed — Chinese/);
  });

  it('detects a moved page', () => {
    const before = spec();
    const after = spec({ pages: [before.pages[1], before.pages[0], before.pages[2]] });
    const d = diffReaderSpecs(before, after);
    expect(d.pages.map(p => p.kind)).toEqual(['moved', 'moved']);
    expect(formatReaderDiff(d)).toContain('Page 1: moved here from page 2 ("我每天穿大衣。")');
  });

  it('detects added and removed pages', () => {
    const before = spec();
    const after = spec({
      pages: [before.pages[0], before.pages[2], { content_chinese: '外面刮风了。', content_pinyin: 'wàimiàn guā fēng le.', content_english: 'It is windy outside.' }],
    });
    const d = diffReaderSpecs(before, after);
    const kinds = d.pages.map(p => `${p.kind}@${p.index}`);
    expect(kinds).toContain('removed@1');
    expect(kinds).toContain('added@2');
    // p3 moved from index 2 to 1
    expect(kinds).toContain('moved@1');
  });

  it('pairs a rewritten page without an id by similarity of the Chinese text', () => {
    const before = spec();
    const after = spec();
    after.pages[0] = { content_chinese: '长春的冬天非常冷。', content_pinyin: '', content_english: 'Winter in Changchun is extremely cold.', image_prompt: 'snowy city' };
    const d = diffReaderSpecs(before, after);
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0].kind).toBe('changed');
  });

  it('treats null and empty image_prompt as the same', () => {
    const after = spec();
    after.pages[1] = { ...after.pages[1], image_prompt: '' };
    expect(diffReaderSpecs(spec(), after).changed).toBe(false);
  });

  it('ignores image_url', () => {
    const after = spec();
    after.pages[0] = { ...after.pages[0], image_url: 'reader-images/p1.png' };
    expect(diffReaderSpecs(spec(), after).changed).toBe(false);
  });
});
