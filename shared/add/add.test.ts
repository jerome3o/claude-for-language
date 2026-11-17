import { describe, expect, it } from 'vitest';
import {
  ADD_CONTENT_TILES,
  addContentLang,
  addContentPlaceholder,
  addContentReady,
  addResultLine,
  classifyWordInput,
  cleanOcrBox,
  ocrChineseText,
  ocrFoundLine,
  ocrResizeDims,
  ocrSpan,
  orderOcrLines,
} from './add';

describe('content tiles', () => {
  it('lists every kind once, Just ask last', () => {
    const kinds = ADD_CONTENT_TILES.map((t) => t.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds[kinds.length - 1]).toBe('ask');
    expect(kinds).toEqual(['reader', 'lesson', 'audio', 'clips', 'picture_hunt', 'deck', 'ask']);
  });
  it('result lines', () => {
    expect(addResultLine('reader', 'making')).toBe('✓ Making your reader…');
    expect(addResultLine('deck', 'ready')).toBe('✓ Your deck is ready');
    expect(addResultLine('clips', 'failed')).toBe("Couldn't make the clip — try again");
  });
  it('audio formats change the box', () => {
    expect(addContentPlaceholder('audio', 'story')).toMatch(/story/);
    expect(addContentLang('audio', 'sleep')).toBe('zh');
    expect(addContentLang('reader')).toBe('en');
    expect(addContentReady('audio', 'cafe', 'story')).toBe(false);
    expect(addContentReady('audio', '我今天去了公园。', 'story')).toBe(true);
    expect(addContentReady('reader', 'a')).toBe(false);
    expect(addContentReady('reader', '猫')).toBe(false);
    expect(addContentReady('reader', '猫咪')).toBe(true);
  });
});

describe('word input', () => {
  it('classifies', () => {
    expect(classifyWordInput('  ')).toBe('empty');
    expect(classifyWordInput('银行')).toBe('chinese');
    expect(classifyWordInput('bank 银行')).toBe('chinese');
    expect(classifyWordInput('bank')).toBe('other');
    expect(classifyWordInput('yínháng')).toBe('other');
  });
});

describe('OCR', () => {
  it('resizes the longer edge only when needed', () => {
    expect(ocrResizeDims(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(ocrResizeDims(3000, 4000)).toEqual({ width: 960, height: 1280 });
    expect(ocrResizeDims(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps the Chinese of a busy line', () => {
    expect(ocrChineseText('太体面了')).toBe('太体面了');
    expect(ocrChineseText('Google Chrome - 太 体 面 了')).toBe('太体面了');
    expect(ocrChineseText('Download 下载 now')).toBe('下载');
    expect(ocrChineseText('点击 Download 下载')).toBe('点击下载');
    expect(ocrChineseText('Mute · Share screen')).toBe('');
    expect(ocrChineseText('2026年11月')).toBe('2026年11月');
    expect(ocrChineseText('你好！')).toBe('你好！');
    expect(ocrChineseText('Hi，你好')).toBe('你好');
  });

  it('cleans boxes', () => {
    expect(cleanOcrBox([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
    expect(cleanOcrBox([30, 40, 10, 20])).toEqual([10, 20, 30, 40]);
    expect(cleanOcrBox([0, 0, 0, 10])).toBeNull();
    expect(cleanOcrBox([1, 2, 3])).toBeNull();
    expect(cleanOcrBox([-5, 0, 2000, 10])).toEqual([0, 0, 1000, 10]);
    expect(cleanOcrBox('x')).toBeNull();
  });

  it('puts the big central subtitle first and drops the noise', () => {
    const lines = orderOcrLines([
      { text: '新标签页 - Google Chrome', box: [5, 10, 30, 300] },
      { text: 'Share screen', box: [950, 400, 980, 600] },
      { text: '太体面了', box: [700, 350, 780, 650] },
      { text: '视频通话', box: [40, 10, 60, 120] },
      { text: '太体面了', box: [700, 350, 780, 650] },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['太体面了', '新标签页', '视频通话']);
  });

  it('the reader\'s main guess wins; lines without boxes keep their order', () => {
    expect(orderOcrLines([{ text: '一' }, { text: '二', main: true }, { text: '三' }]).map((l) => l.text)).toEqual(['二', '一', '三']);
    expect(orderOcrLines([{ text: 'a' }, { text: '' }])).toEqual([]);
    expect(orderOcrLines(Array.from({ length: 20 }, (_, i) => ({ text: `字${i}` }))).length).toBe(12);
  });

  it('picks a span by hand', () => {
    expect(ocrSpan('太体面了', 1, 2)).toBe('体面');
    expect(ocrSpan('太体面了', 2, 1)).toBe('体面');
    expect(ocrSpan('太体面了', -3, 0)).toBe('太');
    expect(ocrSpan('太体面了', 2, 99)).toBe('面了');
    expect(ocrSpan('', 0, 1)).toBe('');
  });

  it('says what it found', () => {
    expect(ocrFoundLine(0)).toMatch(/No Chinese/);
    expect(ocrFoundLine(1)).toBe('Tap a word to look it up');
    expect(ocrFoundLine(3)).toMatch(/^3 lines/);
  });
});
