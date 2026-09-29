import { describe, expect, it } from 'vitest';
import type { HuntObject } from './types';
import { labelAnchor, objectAt, pointInPolygon } from './geometry';

const table: HuntObject = { id: 'table', hanzi: '桌子', pinyin: 'zhuōzi', english: 'table', alternatives: [], regions: [{ box: { x: 0.1, y: 0.4, w: 0.8, h: 0.5 } }] };
const cup: HuntObject = {
  id: 'cup', hanzi: '杯子', pinyin: 'bēizi', english: 'cup', alternatives: [],
  regions: [{ box: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 }, polygon: [[0.4, 0.3], [0.6, 0.3], [0.5, 0.5]] }],
};

describe('picture hunt geometry', () => {
  it('tests points in a polygon', () => {
    expect(pointInPolygon(0.5, 0.35, cup.regions[0].polygon!)).toBe(true);
    expect(pointInPolygon(0.42, 0.48, cup.regions[0].polygon!)).toBe(false);
  });
  it('prefers the smallest region under the tap', () => {
    expect(objectAt([table, cup], 0.5, 0.42)?.id).toBe('cup');
    expect(objectAt([table, cup], 0.42, 0.48)?.id).toBe('table'); // inside the cup's box but outside its outline
    expect(objectAt([table, cup], 0.2, 0.2)).toBeNull();
    expect(objectAt([table, cup], 0.095, 0.6)?.id).toBe('table'); // just outside the edge
  });
  it('anchors labels inside the picture', () => {
    expect(labelAnchor(table.regions[0])).toEqual({ x: 0.5, y: 0.4, above: true });
    expect(labelAnchor({ box: { x: 0, y: 0, w: 0.04, h: 0.3 } })).toEqual({ x: 0.05, y: 0.3, above: false });
  });
});
