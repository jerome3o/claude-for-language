import { describe, expect, it } from 'vitest';
import {
  cleanTocTitle,
  currentTocIndex,
  firstLineOf,
  materialContents,
  MAX_TOC_ENTRIES,
  MAX_TOC_TITLE,
  outlineToToc,
  pageListToc,
  sanitizeToc,
  slideTitlesToc,
  type OutlineNode,
} from './index';

describe('material contents', () => {
  it('turns a PDF outline into two levels of entries in document order', () => {
    const outline: OutlineNode[] = [
      { title: ' 第一课  把字句 ', page: 0, items: [{ title: '生词', page: 1 }, { title: '语法', page: 2, items: [{ title: 'too deep', page: 3 }] }] },
      { title: 'Lesson 2', page: 4, items: [] },
    ];
    expect(outlineToToc(outline, 6)).toEqual([
      { title: '第一课 把字句', page: 0, level: 0 },
      { title: '生词', page: 1, level: 1 },
      { title: '语法', page: 2, level: 1 },
      { title: 'Lesson 2', page: 4, level: 0 },
    ]);
  });

  it('leaves out entries without a title or a page in the material; their children move up', () => {
    const outline: OutlineNode[] = [
      { title: 'Part A', page: null, items: [{ title: 'A1', page: 1, items: [{ title: 'A1a', page: 2 }] }] },
      { title: '', page: 2 },
      { title: 'Past the end', page: 9 },
      { title: 'Fraction', page: 1.5 },
      { title: 'Negative', page: -1 },
      null as unknown as OutlineNode,
      { title: 5 as unknown as string, page: 1 },
    ];
    expect(outlineToToc(outline, 4)).toEqual([
      { title: 'A1', page: 1, level: 0 },
      { title: 'A1a', page: 2, level: 1 },
    ]);
    expect(outlineToToc(null, 4)).toEqual([]);
  });

  it('caps the number of entries and the title length', () => {
    const many: OutlineNode[] = Array.from({ length: 500 }, (_, i) => ({ title: `S${i}`, page: i % 10 }));
    expect(outlineToToc(many, 10)).toHaveLength(MAX_TOC_ENTRIES);
    expect(cleanTocTitle('x'.repeat(300))).toHaveLength(MAX_TOC_TITLE);
    expect(cleanTocTitle('a\n\tb')).toBe('a b');
    expect(cleanTocTitle(null)).toBe('');
  });

  it('uses slide titles for a PowerPoint', () => {
    expect(slideTitlesToc(['Title', '', null, ' 复习 ', undefined])).toEqual([
      { title: 'Title', page: 0, level: 0 },
      { title: '复习', page: 3, level: 0 },
    ]);
  });

  it('checks stored / sent contents', () => {
    expect(sanitizeToc(null, 3)).toBeNull();
    expect(sanitizeToc({}, 3)).toBeNull();
    expect(sanitizeToc([], 3)).toEqual([]);
    expect(
      sanitizeToc(
        [
          { title: 'A', page: 0, level: 0 },
          { title: 'B', page: 1, level: 3 },
          { title: 'C', page: 3 },
          { title: ' ', page: 0 },
          'x',
          [1],
          { title: 'D', page: '1' },
          { title: 'E', page: 2, level: 'x' },
        ],
        3,
      ),
    ).toEqual([
      { title: 'A', page: 0, level: 0 },
      { title: 'B', page: 1, level: 1 },
      { title: 'E', page: 2, level: 0 },
    ]);
  });

  it('falls back to one row per page with its first line of text', () => {
    expect(firstLineOf('  12 \n—\n把字句的用法\nmore')).toBe('把字句的用法');
    expect(firstLineOf('')).toBe('');
    expect(pageListToc(3, [{ page_index: 0, text: 'Lesson 5\nIntro' }, { page_index: 2, text: '42' }])).toEqual([
      { title: 'Lesson 5', page: 0, level: 0 },
      { title: 'Page 2', page: 1, level: 0 },
      { title: 'Page 3', page: 2, level: 0 },
    ]);
    const pages = [{ page_index: 0, text: 'One' }, { page_index: 1, text: 'Two' }];
    expect(materialContents(null, 2, pages)).toEqual({ source: 'pages', entries: [{ title: 'One', page: 0, level: 0 }, { title: 'Two', page: 1, level: 0 }] });
    expect(materialContents([], 2, pages).source).toBe('pages');
    expect(materialContents([{ title: 'Gone', page: 5 }], 2, pages).source).toBe('pages');
    expect(materialContents([{ title: 'Ch 2', page: 1 }], 2, pages)).toEqual({ source: 'outline', entries: [{ title: 'Ch 2', page: 1, level: 0 }] });
  });

  it('knows which entry the page on show belongs to', () => {
    const entries = [
      { title: 'A', page: 0, level: 0 },
      { title: 'A1', page: 2, level: 1 },
      { title: 'A2', page: 2, level: 1 },
      { title: 'B', page: 5, level: 0 },
    ];
    expect(currentTocIndex(entries, 0)).toBe(0);
    expect(currentTocIndex(entries, 3)).toBe(2);
    expect(currentTocIndex(entries, 9)).toBe(3);
    expect(currentTocIndex(entries.slice(1), 0)).toBe(-1);
    expect(currentTocIndex([], 0)).toBe(-1);
  });
});
