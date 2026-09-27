import { describe, it, expect } from 'vitest';
import { FIXTURES } from './__fixtures__/chars';
import {
  compactStroke,
  createQuiz,
  frechet,
  gradeCharacter,
  hintLevel,
  isComplete,
  matchStroke,
  medianPath,
  mistakeMessage,
  parseCharStrokeData,
  pathLength,
  requestHint,
  resample,
  revealStroke,
  strokeDataFile,
  submitStroke,
  summarizeCharacter,
  summarizeExercise,
  writtenFromMemory,
  writableCharacters,
  type CharStrokeData,
  type Point,
  type QuizFeedback,
} from './index';

/** A "hand-drawn" version of a median: resampled, shifted, with deterministic wobble. */
function draw(median: [number, number][], opts: { dx?: number; dy?: number; wobble?: number; n?: number } = {}): Point[] {
  const { dx = 0, dy = 0, wobble = 0, n = 30 } = opts;
  const pts = resample(median.map(([x, y]) => ({ x, y })), n);
  return pts.map((p, i) => ({ x: p.x + dx + wobble * Math.sin(i * 1.7), y: p.y + dy + wobble * Math.cos(i * 2.3) }));
}

const 三 = FIXTURES['三'];
const 十 = FIXTURES['十'];
const 口 = FIXTURES['口'];
const 人 = FIXTURES['人'];
const 你 = FIXTURES['你'];

describe('geometry', () => {
  it('resamples to equally spaced points, keeping the endpoints', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const r = resample(line, 5);
    expect(r.map((p) => p.x)).toEqual([0, 25, 50, 75, 100]);
    const bent = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 3);
    expect(bent[1]).toEqual({ x: 10, y: 0 });
    expect(pathLength(bent)).toBeCloseTo(20);
  });

  it('frechet distance is 0 for identical curves and grows with offset', () => {
    const a = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
    expect(frechet(a, a)).toBe(0);
    const b = a.map((p) => ({ x: p.x, y: p.y + 7 }));
    expect(frechet(a, b)).toBeCloseTo(7);
  });

  it('compacts a drawing to ≤ 24 rounded points', () => {
    const pts = draw(你.medians[0], { n: 120, wobble: 3 });
    const c = compactStroke(pts);
    expect(c.length).toBeLessThanOrEqual(24);
    expect(c.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
  });
});

describe('matchStroke', () => {
  it('accepts every stroke of several characters drawn along its median, in order', () => {
    for (const [ch, data] of Object.entries(FIXTURES)) {
      data.medians.forEach((m, i) => {
        const v = matchStroke(draw(m, { wobble: 8 }), data, i, { outlineVisible: true }).verdict;
        expect(`${ch}#${i}:${v}`).toBe(`${ch}#${i}:correct`);
      });
    }
  });

  it('forgives a hand-drawn offset in recall mode', () => {
    expect(matchStroke(draw(十.medians[0], { dx: 40, dy: -50, wobble: 12 }), 十, 0).verdict).toBe('correct');
    expect(matchStroke(draw(十.medians[1], { dx: -45, dy: 30, wobble: 12 }), 十, 1).verdict).toBe('correct');
  });

  it('flags a stroke drawn backwards', () => {
    const reversed = draw(十.medians[0]).reverse();
    expect(matchStroke(reversed, 十, 0).verdict).toBe('backwards');
    const up = draw(十.medians[1]).reverse();
    expect(matchStroke(up, 十, 1).verdict).toBe('backwards');
  });

  it('spots a later stroke drawn too early (wrong order) and says which', () => {
    // 十: vertical before horizontal
    const m = matchStroke(draw(十.medians[1]), 十, 0);
    expect(m.verdict).toBe('wrong_order');
    expect(m.matchedIndex).toBe(1);
    // 三: bottom line first
    const b = matchStroke(draw(三.medians[2]), 三, 0);
    expect(b.verdict).toBe('wrong_order');
    expect(b.matchedIndex).toBe(2);
    // 口: the closing bottom stroke before the 横折
    const k = matchStroke(draw(口.medians[2]), 口, 1);
    expect(k).toMatchObject({ verdict: 'wrong_order', matchedIndex: 2 });
  });

  it('does not call the middle line of 三 out of order when the top line is drawn', () => {
    expect(matchStroke(draw(三.medians[0], { dy: -30, wobble: 6 }), 三, 0).verdict).toBe('correct');
    expect(matchStroke(draw(三.medians[1], { wobble: 6 }), 三, 1).verdict).toBe('correct');
  });

  it('going over an already-written stroke is not the next one, even when they are close', () => {
    const two: CharStrokeData = {
      strokes: ['', ''],
      medians: [
        [[200, 600], [800, 600]],
        [[200, 480], [800, 480]],
      ],
    };
    expect(matchStroke(draw(two.medians[0]), two, 1).verdict).toBe('wrong');
    expect(matchStroke(draw(two.medians[1], { wobble: 6 }), two, 1).verdict).toBe('correct');
  });

  it('says too short when the stroke starts right but stops halfway', () => {
    const full = draw(十.medians[0], { n: 40 });
    expect(matchStroke(full.slice(0, 14), 十, 0).verdict).toBe('too_short');
  });

  it('rejects a scribble in the wrong place', () => {
    const scribble: Point[] = [
      { x: 100, y: 800 },
      { x: 180, y: 700 },
      { x: 120, y: 650 },
      { x: 200, y: 600 },
    ];
    expect(matchStroke(scribble, 人, 0).verdict).toBe('wrong');
    // a horizontal where 人 wants its left-falling stroke
    expect(matchStroke(draw(十.medians[0]), 人, 0).verdict).toBe('wrong');
  });

  it('ignores taps', () => {
    expect(matchStroke([{ x: 500, y: 500 }], 十, 0).verdict).toBe('ignored');
    expect(matchStroke([{ x: 500, y: 500 }, { x: 505, y: 503 }], 十, 0).verdict).toBe('ignored');
  });
});

describe('writing quiz', () => {
  const T0 = 1_000_000;

  function writeAll(data: CharStrokeData, char: string) {
    let s = createQuiz(char, data, { mode: 'trace' }, T0);
    data.medians.forEach((m, i) => {
      const r = submitStroke(s, draw(m, { wobble: 5 }), T0 + (i + 1) * 800);
      expect(r.feedback.kind).toBe('correct');
      s = r.state;
    });
    return s;
  }

  it('walks a character stroke by stroke and grades a clean run as perfect', () => {
    const s = writeAll(十, '十');
    expect(isComplete(s)).toBe(true);
    const r = summarizeCharacter(s, T0 + 5000);
    expect(r).toMatchObject({ character: '十', mistakes: 0, hints: 0, revealed: 0, grade: 'perfect', accuracy: 1, ms: 1600 });
    expect(r.strokes.map((x) => x.ms)).toEqual([800, 800]);
    expect(r.strokes[0].drawn!.length).toBeGreaterThan(1);
  });

  it('escalates help: start dot after 2 misses, stroke after 3, filled in after 5', () => {
    let s = createQuiz('十', 十, { mode: 'recall' }, T0);
    const wrong = draw(人.medians[0]);
    const hints: string[] = [];
    let last: QuizFeedback = { kind: 'ignored' };
    for (let i = 0; i < 5; i++) {
      const r = submitStroke(s, wrong, T0 + i);
      s = r.state;
      last = r.feedback;
      if (r.feedback.kind === 'mistake') hints.push(r.feedback.hint);
    }
    expect(hints).toEqual(['none', 'start', 'stroke', 'stroke']);
    expect(last).toEqual({ kind: 'revealed', index: 0, complete: false });
    expect(s.current).toBe(1);
    expect(s.done[0]).toMatchObject({ misses: 5, revealed: true, hinted: true });
    expect(hintLevel(s)).toBe('none'); // fresh stroke
  });

  it('records the kind of each mistake and grades them', () => {
    let s = createQuiz('十', 十, { mode: 'trace' }, T0);
    s = submitStroke(s, draw(十.medians[1]), T0 + 1).state; // wrong order
    s = submitStroke(s, draw(十.medians[0]).reverse(), T0 + 2).state; // backwards
    const r = submitStroke(s, draw(十.medians[0]), T0 + 3);
    expect(r.feedback).toEqual({ kind: 'correct', index: 0, complete: false });
    s = r.state;
    expect(s.done[0].mistakes).toEqual(['wrong_order', 'backwards']);
    s = submitStroke(s, draw(十.medians[1]), T0 + 4).state;
    const sum = summarizeCharacter(s, T0 + 10);
    expect(sum.mistakes).toBe(2);
    expect(sum.grade).toBe('practice'); // 2 mistakes on a 2-stroke character
    expect(sum.accuracy).toBe(0.5);
  });

  it('a hint asked for counts against the stroke', () => {
    let s = createQuiz('人', 人, { mode: 'recall' }, T0);
    s = requestHint(s);
    expect(hintLevel(s)).toBe('stroke');
    s = submitStroke(s, draw(人.medians[0]), T0 + 1).state;
    expect(s.done[0].hinted).toBe(true);
    s = revealStroke(s, T0 + 2);
    const sum = summarizeCharacter(s, T0 + 3);
    expect(sum).toMatchObject({ hints: 2, revealed: 1, grade: 'practice' });
  });

  it('an unfinished character is graded practice', () => {
    let s = createQuiz('你', 你, { mode: 'trace' }, T0);
    s = submitStroke(s, draw(你.medians[0]), T0 + 1).state;
    expect(summarizeCharacter(s, T0 + 2).grade).toBe('practice');
  });

  it('grades: one slip on a long character is still good', () => {
    const base = { index: 0, misses: 0, mistakes: [], hinted: false, revealed: false, ms: 0 };
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...base, index: i }));
    expect(gradeCharacter(seven)).toBe('perfect');
    seven[3] = { ...seven[3], misses: 1, mistakes: ['wrong'] as never };
    expect(gradeCharacter(seven)).toBe('good');
  });

  it('summarises a word', () => {
    const a = summarizeCharacter(writeAll(十, '十'), T0);
    const ex = summarizeExercise('十。', 'trace', [a], [], T0, T0 + 10);
    expect(ex.grade).toBe('perfect');
    expect(ex.characters).toHaveLength(1);
  });

  it('only a word written from memory counts as correct; Trace counts as needing help', () => {
    const traced = summarizeExercise('十', 'trace', [summarizeCharacter(writeAll(十, '十'), T0)], [], T0, T0 + 10);
    expect(traced.grade).toBe('perfect');
    expect(writtenFromMemory(traced)).toBe(false);
    let s = createQuiz('十', 十, { mode: 'recall' }, T0);
    for (const m of 十.medians) s = submitStroke(s, draw(m), T0 + 1).state;
    const recalled = summarizeExercise('十', 'recall', [summarizeCharacter(s, T0 + 2)], [], T0, T0 + 10);
    expect(writtenFromMemory(recalled)).toBe(true);
    expect(writtenFromMemory({ mode: 'recall', grade: 'practice' })).toBe(false);
  });

  it('coaching messages use 1-based stroke numbers', () => {
    expect(mistakeMessage({ kind: 'mistake', verdict: 'wrong_order', index: 0, matchedIndex: 1, misses: 1, hint: 'none' })).toBe(
      "That's stroke 2 — stroke 1 comes first.",
    );
  });
});

describe('data helpers', () => {
  it('names files by hex code point', () => {
    expect(strokeDataFile('你')).toBe('4f60.json');
    expect(strokeDataFile('𠀀')).toBe('20000.json');
  });

  it('validates stroke JSON and rejects an HTML fallback', () => {
    expect(parseCharStrokeData({ strokes: ['M 0 0 Z'], medians: [[[0, 0], [10, 10]]], radStrokes: [0] })).not.toBeNull();
    expect(parseCharStrokeData('<!doctype html>')).toBeNull();
    expect(parseCharStrokeData({ strokes: ['M 0 0 Z'], medians: [] })).toBeNull();
    expect(parseCharStrokeData({ strokes: [], medians: [] })).toBeNull();
  });

  it('keeps only Han characters of a word', () => {
    expect(writableCharacters('你好！ABC 谢谢')).toEqual(['你', '好', '谢', '谢']);
  });

  it('draws a median as a path', () => {
    expect(medianPath([[1, 2], [3, 4]])).toBe('M 1 2 L 3 4');
  });
});
