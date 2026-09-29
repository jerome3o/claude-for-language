import { describe, expect, it } from 'vitest';
import { cleanAlternatives, cleanBox, cleanRegion, huntObjectProblems, sanitizeHuntPlay, validateHuntObjects } from './validate';
import type { HuntObject } from './types';

const good: HuntObject = {
  id: 'o1', hanzi: '茶杯', pinyin: 'chábēi', english: 'teacup', alternatives: ['杯子'],
  sentence_clue: '桌子上有一个茶杯。', regions: [{ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
};

describe('picture hunt validation', () => {
  it('accepts a clean object', () => {
    expect(huntObjectProblems(good)).toEqual([]);
    expect(validateHuntObjects([good])).toEqual([]);
  });
  it('rejects slashes, tone numbers and a clue without the word', () => {
    const problems = huntObjectProblems({ ...good, hanzi: '杯子/茶杯', pinyin: 'bei1zi', sentence_clue: '我喝水。' });
    expect(problems.join('\n')).toMatch(/ONE clean form/);
    expect(problems.join('\n')).toMatch(/tone numbers/);
    expect(problems.join('\n')).toMatch(/must contain/);
  });
  it('flags duplicates and empty lists', () => {
    expect(validateHuntObjects([])).toContain('No objects were found in the picture');
    expect(validateHuntObjects([good, { ...good, id: 'o2' }]).join()).toMatch(/both called 茶杯/);
  });
  it('clamps boxes and polygons', () => {
    expect(cleanBox({ x: -0.1, y: 0.5, w: 0.3, h: 0.9 })).toEqual({ x: 0, y: 0.5, w: 0.2, h: 0.5 });
    expect(cleanBox({ x: 0.5, y: 0.5, w: 0, h: 0.1 })).toBeNull();
    expect(cleanRegion({ box: { x: 0, y: 0, w: 1, h: 1 }, polygon: [[0, 0], [1.2, 0], [1, 1]] })?.polygon).toEqual([[0, 0], [1, 0], [1, 1]]);
    expect(cleanRegion({ box: { x: 0, y: 0, w: 1, h: 1 }, polygon: [[0, 0]] })?.polygon).toBeUndefined();
  });
  it('cleans alternatives', () => {
    expect(cleanAlternatives('茶杯', ['茶杯', '杯子', 'cup', '杯子', '水杯/杯', ''])).toEqual(['杯子']);
  });
  it('sanitises a play upload', () => {
    const play = sanitizeHuntPlay({ id: 'p1', hunt_id: 'h1', found_ids: ['o1', 'zz', 'o1'], total: 3, hints_used: 2.4, gave_up: true, duration_ms: -5, played_at: '2026-09-01T10:00:00Z' }, new Set(['o1', 'o2', 'o3']));
    expect(play).toEqual({ id: 'p1', hunt_id: 'h1', found_ids: ['o1'], total: 3, hints_used: 2, gave_up: true, duration_ms: 0, played_at: '2026-09-01T10:00:00.000Z' });
    expect(sanitizeHuntPlay({ hunt_id: 'h1' }, null)).toBeNull();
  });
});
