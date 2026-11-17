import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * ONE look for every judged result (shared/study/resultState.ts; index.css `--result-*` + `.result-surface`): the
 * stylesheets that show a verdict never pick their own green / amber / orange — that is how the yellow "Contains" box,
 * an amber "warn", the orange round "✗" and a dark-green "Right" drifted apart (Jerome, Nov 2026: "a discrepancy in the
 * UX"). They use the result tokens. Lab twin: ResultColorsGuardTest.
 */
const FILES = [
  './AnswerDiff.css',
  './YouSaid.css',
  './HardModeFeedback.css',
  './SentenceRound.css',
  './RightMoment.css',
  './DifferenceCompare.css',
  './listenContext.css',
  './SiblingCards.css',
  '../lessons/AnswerCheckCard.css',
  '../lessons/SentenceCheck.css',
];
const FORBIDDEN = /var\(--color-success|var\(--color-warning|#15803d|#16a34a|#22c55e|#4ade80|#d97706|#b45309|#c2410c|#f97316/i;

describe('result components use the one state colours', () => {
  it.each(FILES)('%s', (file) => {
    const offenders = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '') // comments may name the old colours
      .split('\n')
      .filter((line) => FORBIDDEN.test(line));
    expect(offenders).toEqual([]);
  });

  it('the tokens exist in both themes', () => {
    const css = read('../../index.css');
    for (const state of ['right', 'close', 'wrong', 'pending']) {
      expect(css.match(new RegExp(`--result-${state}:`, 'g'))?.length).toBe(2);
      expect(css.match(new RegExp(`--result-${state}-ink:`, 'g'))?.length).toBe(2);
    }
    // The answer diff's marks (colour only; theme/answerMarks.test.ts checks their contrast).
    for (const mark of ['wrong', 'tone', 'extra', 'missing']) {
      expect(css.match(new RegExp(`--mark-${mark}:`, 'g'))?.length).toBe(2);
    }
  });
});
