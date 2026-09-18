import { describe, it, expect } from 'vitest';
import { readerToMarkdown, readerToJson, readerToCsv, readerToExportSpec, readerExportFilename } from './export';
import { validateReaderSpec } from './validate';
import type { ReaderSpec } from './types';

const spec: ReaderSpec = {
  title_chinese: '长春的冬天',
  title_english: 'Winter in Changchun',
  difficulty_level: 'beginner',
  topic: 'winter',
  vocabulary_used: [
    { hanzi: '冷', pinyin: 'lěng', english: 'cold' },
    { hanzi: '大衣', pinyin: 'dàyī', english: 'coat, "overcoat"' },
    { hanzi: '冷', pinyin: 'lěng', english: 'duplicate' },
    { hanzi: ' ', pinyin: '', english: 'blank' },
  ],
  pages: [
    { id: 'p1', content_chinese: '长春的冬天很冷。', content_pinyin: 'Chángchūn de dōngtiān hěn lěng.', content_english: 'Winter in Changchun is very cold.', image_prompt: 'snowy city', image_url: 'reader-images/p1.png' },
    { id: 'p2', content_chinese: '我每天穿大衣。', content_pinyin: '', content_english: 'I wear a coat every day.', image_prompt: null },
  ],
};

describe('readerToMarkdown', () => {
  it('lays out title, pages and a glossary', () => {
    const md = readerToMarkdown(spec);
    expect(md).toContain('# 长春的冬天');
    expect(md).toContain('*Winter in Changchun*');
    expect(md).toContain('Beginner · Topic: winter · 2 pages');
    expect(md).toContain('## 1\n\n长春的冬天很冷。\n\n*Chángchūn de dōngtiān hěn lěng.*\n\nWinter in Changchun is very cold.');
    expect(md).toContain('> Illustration: snowy city');
    // Blank pinyin line is skipped
    expect(md).toContain('## 2\n\n我每天穿大衣。\n\nI wear a coat every day.');
    expect(md).toContain('## Glossary');
    expect(md).toContain('| 冷 | lěng | cold |');
    expect(md).not.toContain('duplicate');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('omits the glossary when there is no vocabulary', () => {
    expect(readerToMarkdown({ ...spec, vocabulary_used: [] })).not.toContain('Glossary');
  });
});

describe('readerToJson / readerToExportSpec', () => {
  it('strips page ids and image keys and stays valid', () => {
    const out = readerToExportSpec(spec);
    expect(out.pages[0]).toEqual({
      content_chinese: '长春的冬天很冷。',
      content_pinyin: 'Chángchūn de dōngtiān hěn lěng.',
      content_english: 'Winter in Changchun is very cold.',
      image_prompt: 'snowy city',
    });
    expect((out.pages[0] as Record<string, unknown>).id).toBeUndefined();
    expect((out.pages[0] as Record<string, unknown>).image_url).toBeUndefined();
    const json = readerToJson(spec);
    expect(json).not.toContain('image_url');
    expect(validateReaderSpec(JSON.parse(json))).toEqual([]);
  });
});

describe('readerToCsv', () => {
  it('writes deduplicated hanzi/pinyin/english rows with quoting', () => {
    const csv = readerToCsv(spec);
    expect(csv.split('\n')).toEqual(['hanzi,pinyin,english', '冷,lěng,cold', '大衣,dàyī,"coat, ""overcoat"""', '']);
  });
});

describe('readerExportFilename', () => {
  it('slugifies the English title', () => {
    expect(readerExportFilename(spec, 'md')).toBe('Winter-in-Changchun.md');
    expect(readerExportFilename({ ...spec, title_english: '' }, 'csv')).toBe('长春的冬天.csv');
    expect(readerExportFilename({ ...spec, title_english: ' ', title_chinese: '/' }, 'json')).toBe('reader.json');
  });
});
