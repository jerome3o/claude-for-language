/**
 * Judge each sentence / Choose the word: Check waits for every sentence, marks each one with an
 * icon AND words (never colour alone), shows a wrong sentence's correction + why, the full gapped
 * sentence, and reports per-sentence answers (one point each) on Continue.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ExerciseAnswer } from '@shared/lesson';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import { JudgeExercise, GapChoiceExercise } from './judge-gap-exercises';
import { track } from '../services/analytics';

vi.mock('../services/analytics', () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const judge = SAMPLE_LESSONS.find(s => s.id === 'judge')!.spec.sections[0].exercises[0];
const gap = SAMPLE_LESSONS.find(s => s.id === 'gap_choice')!.spec.sections[0].exercises[0];

const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });
const buttons = (row: Element) => Array.from(row.querySelectorAll('button.jg-opt')) as HTMLButtonElement[];
const check = () => host!.querySelector('[data-testid="jg-check"]') as HTMLButtonElement;
const button = (text: string) => Array.from(host!.querySelectorAll('button')).find(b => b.textContent === text);

describe('JudgeExercise', () => {
  it('checks every judgement and shows the correction for the wrong sentences', () => {
    if (judge.type !== 'judge') throw new Error('sample changed');
    const onNext = vi.fn<(c: boolean, a?: ExerciseAnswer) => void>();
    const speak = vi.fn();
    render(<JudgeExercise exercise={judge} speak={speak} onNext={onNext} />);
    const rows = Array.from(host!.querySelectorAll('[data-testid^="judge-row-"]'));
    expect(rows).toHaveLength(5);
    expect(check().disabled).toBe(true);
    expect(check().textContent).toBe('Check · 5 to go');
    // Sample: right, wrong, right, wrong, right. Judge #4 wrongly as correct.
    const verdicts = [true, false, true, true, true];
    rows.forEach((row, i) => click(buttons(row)[verdicts[i] ? 0 : 1]));
    expect(buttons(rows[1])[1].getAttribute('aria-pressed')).toBe('true');
    expect(check().disabled).toBe(false);
    click(check());
    expect(rows[0].textContent).toContain('✓ Right — this sentence is correct');
    expect(rows[3].textContent).toContain('✗ Not quite — this sentence has a mistake');
    expect(rows[3].textContent).toContain('我每天喝咖啡。');
    expect(rows[3].textContent).toContain('A habit (每天)');
    expect(rows[3].className).toContain('miss');
    expect(host!.textContent).toContain('4 of 5 right');
    expect(track).toHaveBeenCalledWith('lesson.items_checked', { exercise_type: 'judge', items: 5, right: 4 });
    // ▶ plays the correction — never the mistake.
    click(rows[3].querySelector('.jg-fix .jg-play'));
    expect(speak).toHaveBeenLastCalledWith('我每天喝咖啡。');
    expect(rows[3].querySelectorAll('.jg-play')).toHaveLength(1);
    click(button('Continue'));
    expect(onNext).toHaveBeenCalledWith(false, { items: verdicts.map((judged, i) => ({ judged, correct: i !== 3 })) });
  });
});

describe('GapChoiceExercise', () => {
  it('fills the gap with the pick, then shows the full sentence with pinyin', () => {
    if (gap.type !== 'gap_choice') throw new Error('sample changed');
    const onNext = vi.fn();
    const speak = vi.fn();
    render(<GapChoiceExercise exercise={gap} speak={speak} onNext={onNext} />);
    const rows = Array.from(host!.querySelectorAll('[data-testid^="gap-row-"]'));
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).not.toContain('___');
    expect(buttons(rows[0]).map(b => b.textContent)).toEqual(['刚', '刚才']);
    const picks = ['刚才', '刚', '刚', '刚']; // #3 wrong (刚才)
    rows.forEach((row, i) => click(buttons(row).find(b => b.textContent === picks[i])));
    expect(rows[1].querySelector('.jg-gap')!.textContent).toBe('刚');
    click(check());
    expect(rows[2].textContent).toContain('✗ You chose 刚 — it’s 刚才');
    expect(rows[2].textContent).toContain('Wǒ gāngcái méi tīngjiàn');
    expect(rows[2].querySelector('.jg-gap')!.textContent).toBe('刚才');
    expect(buttons(rows[2]).map(b => b.textContent)).toEqual(['✗ 刚', '✓ 刚才']);
    expect(rows[0].textContent).toContain('✓ 刚才');
    click(rows[2].querySelector('.jg-play'));
    expect(speak).toHaveBeenLastCalledWith('我刚才没听见，你再说一遍。');
    expect(host!.textContent).toContain('3 of 4 right');
    click(button('Continue'));
    expect(onNext).toHaveBeenCalledWith(false, { items: picks.map((pick, i) => ({ pick, correct: i !== 2 })) });
  });
});
