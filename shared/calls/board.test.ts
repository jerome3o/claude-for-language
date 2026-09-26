import { describe, it, expect } from 'vitest';
import { applyBoardOp, capBoardSize, lastItemBy, sanitizeBoardOp, MAX_BOARD_OPS, type BoardItem } from './board';

const stroke = (id: string, by = 'u1'): BoardItem => ({ type: 'stroke', id, by, color: '#1f2937', width: 4, points: [[0.1, 0.1], [0.2, 0.2]] });

describe('sanitizeBoardOp', () => {
  it('keeps a valid stroke, clamps and rounds its points and stamps the sender', () => {
    const op = sanitizeBoardOp({ type: 'stroke', id: 's1', by: 'spoofed', color: '#dc2626', width: 4, points: [[0.123456, 1.4], [-2, 0.5], ['x', 1]] }, 'u1');
    expect(op).toEqual({ type: 'stroke', id: 's1', by: 'u1', color: '#dc2626', width: 4, points: [[0.1235, 1], [0, 0.5]] });
  });

  it('refuses strokes with a bad colour, width or no points', () => {
    expect(sanitizeBoardOp({ type: 'stroke', id: 's', color: 'red', width: 4, points: [[0, 0]] }, 'u')).toBeNull();
    expect(sanitizeBoardOp({ type: 'stroke', id: 's', color: '#000000', width: 400, points: [[0, 0]] }, 'u')).toBeNull();
    expect(sanitizeBoardOp({ type: 'stroke', id: 's', color: '#000000', width: 4, points: [] }, 'u')).toBeNull();
  });

  it('trims text and refuses empty text', () => {
    expect(sanitizeBoardOp({ type: 'text', id: 't', color: '#000000', x: 0.5, y: 0.5, size: 40, text: '  你好 nǐ hǎo  ' }, 'u'))
      .toMatchObject({ text: '你好 nǐ hǎo', by: 'u' });
    expect(sanitizeBoardOp({ type: 'text', id: 't', color: '#000000', x: 0.5, y: 0.5, size: 40, text: '   ' }, 'u')).toBeNull();
  });

  it('accepts delete and clear, refuses unknown types', () => {
    expect(sanitizeBoardOp({ type: 'delete', id: 's1' }, 'u')).toEqual({ type: 'delete', id: 's1', by: 'u' });
    expect(sanitizeBoardOp({ type: 'clear' }, 'u')).toEqual({ type: 'clear', by: 'u' });
    expect(sanitizeBoardOp({ type: 'explode' }, 'u')).toBeNull();
    expect(sanitizeBoardOp(null, 'u')).toBeNull();
  });
});

describe('applyBoardOp', () => {
  it('adds, replaces by id, deletes and clears', () => {
    let items = applyBoardOp([], stroke('a'));
    items = applyBoardOp(items, stroke('b', 'u2'));
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    items = applyBoardOp(items, { ...stroke('a'), color: '#dc2626' } as BoardItem);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    items = applyBoardOp(items, { type: 'delete', id: 'b', by: 'u1' });
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(applyBoardOp(items, { type: 'clear', by: 'u1' })).toEqual([]);
  });

  it('drops the oldest items past the cap', () => {
    let items: BoardItem[] = [];
    for (let i = 0; i < MAX_BOARD_OPS + 5; i++) items = applyBoardOp(items, stroke(`s${i}`));
    expect(items).toHaveLength(MAX_BOARD_OPS);
    expect(items[0].id).toBe('s5');
  });
});

describe('lastItemBy', () => {
  it("finds the user's most recent item for undo", () => {
    const items = [stroke('a', 'u1'), stroke('b', 'u2'), stroke('c', 'u1'), stroke('d', 'u2')];
    expect(lastItemBy(items, 'u1')).toBe('c');
    expect(lastItemBy(items, 'u3')).toBeNull();
  });
});

describe('capBoardSize', () => {
  it('drops the oldest items until the JSON fits', () => {
    const items = Array.from({ length: 10 }, (_, i) => stroke(`s${i}`));
    const one = JSON.stringify(items[0]).length + 1;
    const capped = capBoardSize(items, one * 4 + 2);
    expect(capped.map((i) => i.id)).toEqual(['s6', 's7', 's8', 's9']);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(one * 4 + 2);
    expect(capBoardSize(items)).toBe(items);
  });
});
