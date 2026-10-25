/**
 * Hard mode in the pass (docs/HOMEWORK.md §3d): after a give-up Got it is locked — a tap answers nothing
 * and says why; Not yet still answers.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PASS_GAVE_UP_BLOCKED, PASS_GAVE_UP_LINE } from '@shared/homework';
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
  it('a locked Got it answers nothing and says why; Not yet answers', () => {
    const onAnswer = vi.fn();
    const el = render(<PassAnswerButtons suggested="wrong" onAnswer={onAnswer} gotItLocked={{ line: PASS_GAVE_UP_LINE, blockedNote: PASS_GAVE_UP_BLOCKED }} />);
    expect(q(el, 'hw-pass-locked')?.textContent).toBe(PASS_GAVE_UP_LINE);
    expect(q(el, 'hw-gotit')?.dataset.locked).toBe('true');
    act(() => q(el, 'hw-gotit')!.click());
    expect(onAnswer).not.toHaveBeenCalled();
    expect(q(el, 'hw-pass-locked')?.textContent).toBe(PASS_GAVE_UP_BLOCKED);
    act(() => q(el, 'hw-notyet')!.click());
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('unlocked: as before', () => {
    const onAnswer = vi.fn();
    const el = render(<PassAnswerButtons suggested="right" onAnswer={onAnswer} />);
    expect(q(el, 'hw-pass-locked')).toBeNull();
    act(() => q(el, 'hw-gotit')!.click());
    expect(onAnswer).toHaveBeenCalledWith(true);
  });
});
