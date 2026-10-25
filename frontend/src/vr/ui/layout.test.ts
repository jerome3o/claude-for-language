import { describe, expect, it } from 'vitest';
import { exploreSegments, hitAt, layoutUi, tokenize, wrapTokens, type Measure, type UiNode } from './layout';

/** Fake metrics: a CJK character is `size` wide, anything else half of it. */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 30);
  let w = 0;
  for (const ch of text) w += /[一-鿿　-〿＀-￯]/.test(ch) ? size : size / 2;
  return w;
};

describe('tokenize / wrap', () => {
  it('CJK breaks per character, Latin per word', () => {
    const toks = tokenize('我爱 hello world', 30, 400, measure);
    expect(toks.map((t) => t.text)).toEqual(['我', '爱', ' ', 'hello', ' ', 'world']);
  });

  it('wraps greedily without leading / trailing spaces', () => {
    const lines = wrapTokens(tokenize('one two three four', 20, 400, measure), 95);
    // "one two " = 8 chars × 10 = 80; "three" would overflow
    expect(lines.map((l) => l.tokens.map((t) => t.text).join(''))).toEqual(['one two', 'three', 'four']);
    for (const l of lines) expect(l.tokens[0].space).toBe(false);
  });

  it('a hard line break starts a new line', () => {
    const lines = wrapTokens(tokenize('第一\n第二', 30, 400, measure), 1000);
    expect(lines).toHaveLength(2);
  });

  it('emoji get their own font', () => {
    const toks = tokenize('📚 Study', 30, 600, measure);
    expect(toks[0].font).toContain('Emoji');
    expect(toks[2].font).not.toContain('Emoji');
  });

  it('explore segments: the given words when they match the text, else characters', () => {
    expect(exploreSegments('我去银行', ['我', '去', '银行'])).toEqual(['我', '去', '银行']);
    expect(exploreSegments('我去银行', ['我', '银行'])).toEqual(['我', '去', '银', '行']);
    expect(exploreSegments('你好')).toEqual(['你', '好']);
  });
});

describe('layoutUi', () => {
  it('stacks nodes and reports the height', () => {
    const nodes: UiNode[] = [
      { t: 'text', text: 'Hello', size: 30 },
      { t: 'button', label: 'Show answer', action: 'reveal' },
    ];
    const l = layoutUi(nodes, { width: 1000, measure });
    expect(l.height).toBeGreaterThan(100);
    expect(l.hits.map((h) => h.action)).toEqual(['reveal']);
    expect(l.texts.size).toBeGreaterThan(0);
  });

  it('explorable Chinese gets one tap target per Han word; punctuation none', () => {
    const l = layoutUi([{ t: 'text', text: '我去银行。', explore: true, segments: ['我', '去', '银行', '。'] }], { width: 1000, measure });
    expect(l.hits.map((h) => h.action)).toEqual(['explore:我', 'explore:去', 'explore:银行']);
    const bank = l.hits[2];
    expect(bank.w).toBeGreaterThan(l.hits[0].w); // two characters wide
  });

  it('a word split across lines is tappable on both lines', () => {
    const l = layoutUi([{ t: 'text', text: '银行', size: 100, explore: true, segments: ['银行'] }], { width: 172, padding: 36, measure }); // 100 px inner: one character a line
    expect(l.hits.map((h) => h.action)).toEqual(['explore:银行', 'explore:银行']);
    expect(l.hits[1].y).toBeGreaterThan(l.hits[0].y);
  });

  it('fill rows share the width; wrap rows wrap', () => {
    const fill = layoutUi([{ t: 'row', mode: 'fill', children: ['a', 'b', 'c', 'd'].map((x) => ({ t: 'button' as const, label: x, action: x })) }], { width: 1000, measure });
    const widths = fill.hits.map((h) => h.w);
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(1);
    const wrap = layoutUi([{ t: 'row', mode: 'wrap', children: Array.from({ length: 12 }, (_, i) => ({ t: 'button' as const, label: `chip number ${i}`, action: `c${i}` })) }], { width: 600, measure });
    const ys = new Set(wrap.hits.map((h) => h.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('disabled buttons draw but cannot be pressed', () => {
    const l = layoutUi([{ t: 'button', label: 'Check', action: 'check', disabled: true }], { width: 800, measure });
    expect(l.hits).toHaveLength(0);
    expect(l.ops.some((o) => o.op === 'text' && o.text === 'Check')).toBe(true);
  });

  it('lists: a row per item, the whole row a target', () => {
    const l = layoutUi([{ t: 'list', items: [{ title: '小明在巴黎', sub: 'Xiaoming in Paris', action: 'open:r1' }, { title: 'B', action: 'open:r2' }] }], { width: 1000, measure });
    expect(l.hits.map((h) => h.action)).toEqual(['open:r1', 'open:r2']);
    expect(l.hits[0].w).toBe(1000 - 72);
  });

  it('a bar puts its buttons on the right', () => {
    const l = layoutUi([{ t: 'bar', title: 'Study', buttons: [{ t: 'button', label: '✕', action: 'close' }] }], { width: 1000, padding: 14, measure });
    expect(l.hits[0].action).toBe('close');
    expect(l.hits[0].x + l.hits[0].w).toBeCloseTo(1000 - 14, 0);
  });

  it('maxHeight cuts the content and its targets', () => {
    const nodes: UiNode[] = Array.from({ length: 30 }, (_, i) => ({ t: 'button' as const, label: `b${i}`, action: `b${i}` }));
    const l = layoutUi(nodes, { width: 800, measure, maxHeight: 500 });
    expect(l.height).toBe(500);
    expect(l.hits.every((h) => h.y < 500)).toBe(true);
  });

  it('hitAt finds the region under a pixel', () => {
    const l = layoutUi([{ t: 'button', label: 'A', action: 'a' }, { t: 'button', label: 'B', action: 'b' }], { width: 800, measure });
    const b = l.hits[1];
    expect(hitAt(l, b.x + 5, b.y + 5)?.action).toBe('b');
    expect(hitAt(l, 1, 1)).toBeNull();
  });
});
