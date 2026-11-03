/**
 * Hard mode in the pass (docs/HOMEWORK.md §3e): after a give-up Got it is greyed — the first tap answers
 * nothing and says "Tap again…", a second tap within 3 s says Got it anyway; Not yet still answers.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PASS_GOT_IT_OVERRIDE, PASS_GAVE_UP_LINE } from '@shared/homework';
import { PassAnswerButtons } from './PassAnswerButtons';

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

const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('PassAnswerButtons', () => {
  it('a greyed Got it: the first tap asks again, Not yet answers', () => {
    const onAnswer = vi.fn();
    const el = render(<PassAnswerButtons suggested="wrong" onAnswer={onAnswer} gotItLocked={{ line: PASS_GAVE_UP_LINE, overridePrompt: PASS_GOT_IT_OVERRIDE }} />);
    expect(q(el, 'hw-pass-locked')?.textContent).toBe(PASS_GAVE_UP_LINE);
    expect(q(el, 'hw-gotit')?.dataset.locked).toBe('true');
    act(() => q(el, 'hw-gotit')!.click());
    expect(onAnswer).not.toHaveBeenCalled();
    expect(q(el, 'hw-pass-locked')?.textContent).toBe(PASS_GOT_IT_OVERRIDE);
    expect(q(el, 'hw-gotit')?.dataset.armed).toBe('true');
    act(() => q(el, 'hw-notyet')!.click());
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('a second tap on the greyed Got it within 3 s says Got it anyway', () => {
    const onAnswer = vi.fn();
    const el = render(<PassAnswerButtons suggested={null} onAnswer={onAnswer} gotItLocked={{ line: PASS_GAVE_UP_LINE, overridePrompt: PASS_GOT_IT_OVERRIDE }} />);
    act(() => q(el, 'hw-gotit')!.click());
    act(() => q(el, 'hw-gotit')!.click());
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('unlocked: as before', () => {
    const onAnswer = vi.fn();
    const el = render(<PassAnswerButtons suggested="right" onAnswer={onAnswer} />);
    expect(q(el, 'hw-pass-locked')).toBeNull();
    act(() => q(el, 'hw-gotit')!.click());
    expect(onAnswer).toHaveBeenCalledWith(true);
  });
});
