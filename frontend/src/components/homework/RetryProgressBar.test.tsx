/**
 * The retry progress bar renders the pure `passRetryBar`: blue from the left, the hatched orange
 * from the right end, "↺ N" beside it, an accessible label — through Got it, Not yet, retries,
 * ↺ undo and the finish.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { passRetryBar, retryBar, type PassEvent } from '@shared/homework';
import { RetryProgressBar } from './RetryProgressBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(el: React.ReactElement) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(el));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const ids = ['a', 'b', 'c', 'd'];
let n = 0;
const ev = (item_id: string, result: PassEvent['result'], undoes?: string): PassEvent => ({
  id: `e${n}`,
  item_id,
  result,
  undoes,
  created_at: `2026-10-22T10:${String(n++).padStart(2, '0')}:00.000Z`,
});

describe('RetryProgressBar', () => {
  it('starts empty with an accessible label', () => {
    render(<RetryProgressBar bar={passRetryBar(ids, [])} />);
    const bar = q('retry-progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('0 of 4 words done');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(q('retry-progress-bar-done').style.width).toBe('0%');
    expect(q('retry-progress-bar-retry').style.width).toBe('0%');
    // The badge slot is kept (so the track never shrinks) but empty.
    expect(q('retry-progress-bar-badge').textContent).toBe('');
  });

  it('a Not yet moves the blue and grows the orange at the right end, with ↺ N', () => {
    const events = [ev('a', 'wrong'), ev('b', 'right'), ev('c', 'wrong')];
    render(<RetryProgressBar bar={passRetryBar(ids, events)} />);
    // 3 answers of 6 slots; 2 owed at the right.
    expect(q('retry-progress-bar-done').style.width).toBe('50%');
    expect(parseFloat(q('retry-progress-bar-retry').style.width)).toBeCloseTo(100 / 3, 5);
    expect(q('retry-progress-bar-retry').className).toContain('retry-bar-retry--shown');
    expect(q('retry-progress-bar-badge').textContent).toBe('↺ 2');
    expect(q('retry-progress-bar').getAttribute('aria-label')).toBe('1 of 4 words done · 2 to retry');
  });

  it('on retries the blue meets the orange; ↺ undo takes the bar back', () => {
    const events = [ev('a', 'wrong'), ev('b', 'right'), ev('c', 'right'), ev('d', 'right')];
    render(<RetryProgressBar bar={passRetryBar(ids, events)} />);
    expect(q('retry-progress-bar').className).toContain('retry-bar--on-retries');
    expect(q('retry-progress-bar-done').style.width).toBe('80%');
    expect(q('retry-progress-bar-retry').style.width).toBe('20%');
    const undone = [...events, ev('d', 'undo', events[3].id)];
    render(<RetryProgressBar bar={passRetryBar(ids, undone)} />);
    expect(q('retry-progress-bar').className).not.toContain('retry-bar--on-retries');
    expect(q('retry-progress-bar-done').style.width).toBe('60%');
  });

  it('finished = full blue, no orange, no badge', () => {
    const events = [ev('a', 'wrong'), ev('b', 'right'), ev('c', 'right'), ev('d', 'right'), ev('a', 'right')];
    render(<RetryProgressBar bar={passRetryBar(ids, events)} />);
    expect(q('retry-progress-bar').className).toContain('retry-bar--complete');
    expect(q('retry-progress-bar-done').style.width).toBe('100%');
    expect(q('retry-progress-bar-retry').style.width).toBe('0%');
    expect(q('retry-progress-bar-badge').textContent).toBe('');
    expect(q('retry-progress-bar').getAttribute('aria-label')).toBe('All 4 words done');
  });

  it('takes another unit and can drop the badge', () => {
    render(<RetryProgressBar bar={retryBar({ answered: 2, fresh: 3, retries: 1, itemsDone: 1, items: 5 })} unit={{ one: 'exercise', other: 'exercises' }} showBadge={false} testId="lesson-bar" />);
    expect(q('lesson-bar').getAttribute('aria-label')).toBe('1 of 5 exercises done · 1 to retry');
    expect(q('lesson-bar-badge')).toBeNull();
  });
});
