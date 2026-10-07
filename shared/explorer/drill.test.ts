import { describe, expect, it } from 'vitest';
import { buildDrill, drillScoreLine, seededRandom, shortGloss, shuffled } from './drill';

const W = (hanzi: string, pinyin: string, english: string) => ({ hanzi, pinyin, english });
const POOL = [
  W('进行', 'jìnxíng', 'to carry out'),
  W('举行', 'jǔxíng', 'to hold (a meeting)'),
  W('行为', 'xíngwéi', 'behaviour'),
  W('自行车', 'zìxíngchē', 'bicycle'),
  W('银子', 'yínzi', 'silver; money'),
];

describe('seeded random', () => {
  it('is deterministic (mulberry32 vectors)', () => {
    const r = seededRandom(42);
    const a = [r(), r(), r()];
    const r2 = seededRandom(42);
    expect([r2(), r2(), r2()]).toEqual(a);
    expect(a[0]).toBeCloseTo(0.6011037519201636, 12);
    expect(shuffled([1, 2, 3, 4, 5], seededRandom(7))).toEqual(shuffled([1, 2, 3, 4, 5], seededRandom(7)));
  });
});

describe('buildDrill', () => {
  it('a word: meaning, listen, a tone per character, reverse, write — at most 5', () => {
    const q = buildDrill({ kind: 'word', word: W('银行', 'yínháng', 'bank; banking'), syllables: ['yín', 'háng'] }, POOL, 1);
    expect(q.map((x) => x.kind)).toEqual(['meaning', 'listen', 'tone', 'tone', 'write']);
    expect(q[0].options[q[0].answer]).toBe('bank');
    expect(q[0].options).toHaveLength(4);
    expect(q[1].options[q[1].answer]).toBe('银行');
    expect(q[2]).toMatchObject({ prompt: '银', context: '银行', answer: 1, pinyin: 'yín' });
    expect(q[4]).toMatchObject({ kind: 'write', prompt: '银', options: [], answer: -1 });
  });

  it('with max 6 the reverse question fits', () => {
    const q = buildDrill({ kind: 'word', word: W('银行', 'yínháng', 'bank'), syllables: null }, POOL, 3, 6);
    expect(q.map((x) => x.kind)).toEqual(['meaning', 'listen', 'tone', 'tone', 'reverse', 'write']);
    const rev = q[4];
    expect(rev.options[rev.answer]).toBe('进行');
    expect(rev.prompt).toBe('to carry out');
  });

  it('a character: its first two words carry the questions, the tone of the character itself', () => {
    const q = buildDrill({ kind: 'char', char: '行' }, POOL, 9);
    expect(q[0]).toMatchObject({ kind: 'meaning', prompt: '进行' });
    expect(q[1]).toMatchObject({ kind: 'listen', prompt: '举行' });
    expect(q.filter((x) => x.kind === 'tone')).toEqual([expect.objectContaining({ prompt: '行', context: '进行', answer: 1 })]);
    expect(q[q.length - 1]).toMatchObject({ kind: 'write', prompt: '行' });
  });

  it('the same seed gives the same drill; too small a pool gives none', () => {
    const t = { kind: 'word' as const, word: W('银行', 'yínháng', 'bank') };
    expect(buildDrill(t, POOL, 5)).toEqual(buildDrill(t, POOL, 5));
    // No distractors: the tones and the writing still make a drill…
    expect(buildDrill(t, [POOL[0]], 5).map((x) => x.kind)).toEqual(['tone', 'tone', 'write']);
    // …but not without pinyin either.
    expect(buildDrill({ kind: 'word', word: W('银行', '', 'bank') }, [POOL[0]], 5)).toEqual([]);
    expect(buildDrill({ kind: 'char', char: '龘' }, POOL, 5)).toEqual([]);
  });

  it('helpers', () => {
    expect(shortGloss('bank; banking')).toBe('bank');
    expect(drillScoreLine(5, 5)).toBe('5 / 5 — 完美！Perfect');
    expect(drillScoreLine(3, 5)).toBe('3 / 5 — 很好！Nice');
    expect(drillScoreLine(1, 5)).toBe('1 / 5 — 加油！Keep going');
  });
});
