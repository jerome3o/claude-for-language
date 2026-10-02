import { describe, expect, it } from 'vitest';
import {
  cleanPageText,
  materialFileProblem,
  materialKindOf,
  materialTarget,
  materialText,
  MAX_MATERIAL_BYTES,
  parseMaterialTarget,
  sanitizePresented,
  titleFromFileName,
  turnPage,
} from './index';

describe('lesson materials', () => {
  it('knows PDFs, PowerPoints and pictures; says what to do with the rest', () => {
    expect(materialKindOf('Lesson 5.PDF')).toBe('pdf');
    expect(materialKindOf('slides.pptx')).toBe('pptx');
    expect(materialKindOf('photo.jpeg')).toBe('image');
    expect(materialKindOf('blob', 'application/pdf')).toBe('pdf');
    expect(materialKindOf('notes.docx')).toBeNull();
    expect(materialFileProblem('old.ppt', null, 10)).toMatch(/\.pptx/);
    expect(materialFileProblem('talk.key', null, 10)).toMatch(/PDF/);
    expect(materialFileProblem('notes.docx', null, 10)).toMatch(/PDF, a PowerPoint/);
    expect(materialFileProblem('big.pdf', null, MAX_MATERIAL_BYTES + 1)).toMatch(/50 MB/);
    expect(materialFileProblem('ok.pdf', 'application/pdf', 1000)).toBeNull();
    expect(titleFromFileName('Lesson_5  –  把字句.pptx')).toBe('Lesson 5 – 把字句');
  });

  it('tidies page text and joins it for agents, page by page with notes', () => {
    expect(cleanPageText('  我把   作业 \n\n\n\n 做完了 ')).toBe('我把 作业\n\n做完了');
    const t = materialText([
      { page_index: 1, text: '把 + object + verb', notes: 'Ask for 3 examples' },
      { page_index: 0, text: '第五课' },
      { page_index: 2, text: '' },
    ]);
    expect(t).toBe('— Page 1 —\n第五课\n\n— Page 2 —\n把 + object + verb\n(Speaker notes: Ask for 3 examples)');
    expect(materialText([{ page_index: 0, text: 'x'.repeat(50) }], 20)).toMatch(/cut for length/);
  });

  it('annotation targets name a material page; page turns stay inside it', () => {
    expect(parseMaterialTarget(materialTarget('m1', 4))).toEqual({ materialId: 'm1', page: 4 });
    expect(parseMaterialTarget('material:../x:1')).toBeNull();
    expect(parseMaterialTarget(undefined)).toBeNull();
    expect(turnPage(0, -1, 10)).toBe(0);
    expect(turnPage(9, 1, 10)).toBe(9);
    expect(turnPage(3, 1, 10)).toBe(4);
    expect(turnPage(3, 1, 0)).toBe(0);
  });

  it('validates what the room says is presented', () => {
    expect(sanitizePresented({ material_id: 'm1', title: 'L5', page: 99, page_count: 12, by: 'u', by_name: '明慧' })).toEqual({
      material_id: 'm1', title: 'L5', page: 11, page_count: 12, by: 'u', by_name: '明慧',
    });
    expect(sanitizePresented({ material_id: 'm 1', page: 0, page_count: 3 })).toBeNull();
    expect(sanitizePresented({ material_id: 'm1', page: 0, page_count: 0 })).toBeNull();
  });
});
