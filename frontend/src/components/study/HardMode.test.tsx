/**
 * Hard mode (docs/STUDY_SESSION.md "Hard mode"; shared/study/hardMode.ts): the header chip's three
 * settings, and the check of the question's own answer — ✓ Right → Next: harder questions; ✗ Not quite
 * → 🔁 Try again or 👁 Show answer (a miss); still checking → Show answer only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));

// The feel (services/studyFeel.ts): navigator.vibrate is what the phone feels.
const vibrate = vi.fn();
Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  vibrate.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('HardModeChip', () => {
  it('reads the old switch, opens the three choices and sets one', async () => {
    localStorage.setItem('sentence-gate-v1', '1');
    const { HardModeChip } = await import('./HardModeChip');
    const { readHardMode } = await import('../../services/hardModePrefs');
    act(() => root.render(<HardModeChip />));
    expect(q('hard-mode-chip')!.dataset.mode).toBe('all');
    expect(q('hard-mode-chip')!.textContent).toBe('🎯 All');
    expect(q('hard-mode-chip')!.getAttribute('aria-label')).toBe('Hard mode: All cards');
    act(() => q('hard-mode-chip')!.click());
    expect(q('hard-mode-menu')!.textContent).toContain('Red cards only');
    act(() => q('hard-mode-option-red')!.click());
    expect(q('hard-mode-menu')).toBeNull();
    expect(readHardMode()).toBe('red');
    expect(q('hard-mode-chip')!.textContent).toBe('🎯 Red');
    expect(track).toHaveBeenCalledWith('study.hard_mode', { action: 'set', mode: 'red', where: 'header' });
    act(() => q('hard-mode-chip')!.click());
    act(() => q('hard-mode-option-off')!.click());
    expect(q('hard-mode-chip')!.dataset.mode).toBe('off');
  });
});

describe('HardModeFeedback', () => {
  const render = async (result: 'right' | 'close' | 'wrong' | 'checking' | 'unknown' | 'revealed', extra: { roundFollows?: boolean; difference?: { reason: 'homophone'; said: string; model: string; modelPinyin: string } } = {}) => {
    const { HardModeFeedback } = await import('./HardModeFeedback');
    const handlers = { onTryAgain: vi.fn(), onShowAnswer: vi.fn(), onNext: vi.fn(), onPlayAnswer: vi.fn() };
    act(() => root.render(<HardModeFeedback result={result} said="银航" spoken roundFollows={extra.roundFollows ?? true} difference={extra.difference} answer={{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }} {...handlers} />));
    return handlers;
  };
  it('a miss: Not quite, what he said, Try again and Show answer (a miss)', async () => {
    const h = await render('wrong');
    expect(q('hard-feedback')!.dataset.result).toBe('wrong');
    expect(host.textContent).toContain('✗ Not quite');
    expect(q('hard-said')!.textContent).toBe('You said: 银航');
    expect(host.textContent).toContain('Showing the answer counts as a miss');
    act(() => q('hard-try-again')!.click());
    expect(h.onTryAgain).toHaveBeenCalled();
    act(() => q('hard-show-answer')!.click());
    expect(h.onShowAnswer).toHaveBeenCalled();
    expect(q('hard-next')).toBeNull();
  });
  it('right: Next: harder questions (or See the answer when no round follows)', async () => {
    const h = await render('right');
    expect(host.textContent).toContain('✓ Right');
    expect(q('hard-next')!.textContent).toContain('Next: harder questions');
    expect(q('hard-try-again')).toBeNull();
    act(() => q('hard-next')!.click());
    expect(h.onNext).toHaveBeenCalled();
    await render('right', { roundFollows: false });
    expect(q('hard-next')!.textContent).toContain('See the answer');
  });
  it('right by sound only: You said vs the card, the differing characters marked, Next to go on', async () => {
    const h = await render('right', { difference: { reason: 'homophone', said: '由', model: '油', modelPinyin: 'yóu' } });
    expect(q('hard-feedback')!.dataset.held).toBe('true');
    expect(host.textContent).toContain('✓ Sounded right — written differently');
    expect(q('difference-said')!.querySelector('[data-mark="differs"]')!.textContent).toBe('由');
    expect(q('difference-model')!.textContent).toContain('The card');
    expect(q('difference-model')!.textContent).toContain('yóu');
    expect(q('hard-said')).toBeNull();
    act(() => q('hard-next')!.click());
    expect(h.onNext).toHaveBeenCalled();
  });
  it('checking: only Show answer; nearly: ≈ Nearly; unknown: Try again or go on', async () => {
    await render('checking');
    expect(host.textContent).toContain('Checking what you said');
    expect(q('hard-show-answer')).not.toBeNull();
    expect(q('hard-try-again')).toBeNull();
    await render('close');
    expect(host.textContent).toContain('≈ Nearly');
    await render('unknown');
    expect(q('hard-try-again')).not.toBeNull();
    expect(q('hard-next')).not.toBeNull();
  });
  it('right is FELT: a firm double buzz (≥ 35 ms pulses), once per result', async () => {
    await render('right');
    expect(vibrate).toHaveBeenCalledTimes(1);
    const pattern = vibrate.mock.calls[0][0] as number[];
    expect(pattern).toEqual([40, 70, 60]);
    vibrate.mockClear();
    await render('right');
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('a miss buzzes differently; checking, unknown and revealed are silent', async () => {
    await render('wrong');
    expect(vibrate.mock.calls.at(-1)![0]).toEqual([30, 80, 30]);
    vibrate.mockClear();
    await render('checking');
    await render('unknown');
    await render('revealed');
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('the haptics setting off: nothing', async () => {
    localStorage.setItem('study-feel-v1', '0');
    await render('right');
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('👁 Show answer: the answer in place, then Continue to the sentences (or See the full answer)', async () => {
    const h = await render('revealed');
    expect(q('hard-feedback')!.dataset.result).toBe('revealed');
    expect(q('hard-revealed-answer')!.textContent).toContain('银行');
    expect(q('hard-revealed-answer')!.textContent).toContain('yínháng');
    expect(q('hard-revealed-answer')!.textContent).toContain('bank');
    expect(q('hard-continue')!.textContent).toContain('Continue to the sentences');
    expect(q('hard-try-again')).toBeNull();
    act(() => q('hard-revealed-play')!.click());
    expect(h.onPlayAnswer).toHaveBeenCalled();
    act(() => q('hard-continue')!.click());
    expect(h.onNext).toHaveBeenCalled();
    await render('revealed', { roundFollows: false });
    expect(q('hard-continue')!.textContent).toContain('See the full answer');
  });
});

describe('HardModeRatings: greyed, never locked', () => {
  const previews = Object.fromEntries([0, 1, 2, 3].map((r) => [r, { intervalText: ['1m', '6m', '10m', '2d'][r] }])) as never;
  const render = async (goodEasy: import('@shared/study/hardMode').GoodEasyGate) => {
    const { HardModeRatings } = await import('./HardModeRatings');
    const h = { onRate: vi.fn(), onArmed: vi.fn(), onOverride: vi.fn() };
    act(() => root.render(<HardModeRatings goodEasy={goodEasy} intervalPreviews={previews} disabled={false} {...h} />));
    return h;
  };
  const greyed = { state: 'suggest_lower', reason: 'gave_up', label: '👁 You looked at the answer — Again or Hard suggested', gaveUp: true } as const;
  it('Good / Easy greyed, Hard suggested; Again and Hard rate at once', async () => {
    const h = await render(greyed);
    expect(q('rating-good')!.dataset.greyed).toBe('true');
    expect(q('rating-easy')!.dataset.greyed).toBe('true');
    expect(q('rating-good')!.hasAttribute('disabled')).toBe(false);
    expect(q('rating-hard')!.dataset.suggested).toBe('true');
    expect(q('rating-hard')!.textContent).toContain('suggested');
    act(() => q('rating-again')!.click());
    expect(h.onRate).toHaveBeenCalledWith(0);
  });
  it('the first tap on Good says "Tap again…", the second rates it (an override)', async () => {
    const h = await render(greyed);
    act(() => q('rating-good')!.click());
    expect(h.onRate).not.toHaveBeenCalled();
    expect(h.onArmed).toHaveBeenCalledWith(2);
    expect(q('sentence-gate')!.textContent).toBe('Tap again to rate Good anyway');
    expect(q('rating-good')!.dataset.armed).toBe('true');
    act(() => q('rating-good')!.click());
    expect(h.onOverride).toHaveBeenCalledWith(2);
    expect(h.onRate).toHaveBeenCalledWith(2);
  });
  it('the arm wears off after 3 s', async () => {
    vi.useFakeTimers();
    try {
      const h = await render(greyed);
      act(() => q('rating-easy')!.click());
      act(() => { vi.advanceTimersByTime(3100); });
      expect(q('sentence-gate')!.textContent).toBe(greyed.label);
      act(() => q('rating-easy')!.click());
      expect(h.onRate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('open: every rating rates at once, nothing greyed', async () => {
    const h = await render({ state: 'open', reason: null, label: '✓ 2/2 right — Good and Easy unlocked', gaveUp: false });
    expect(q('rating-good')!.dataset.greyed).toBeUndefined();
    expect(q('rating-hard')!.dataset.suggested).toBeUndefined();
    act(() => q('rating-good')!.click());
    expect(h.onRate).toHaveBeenCalledWith(2);
    expect(h.onOverride).not.toHaveBeenCalled();
  });
});
