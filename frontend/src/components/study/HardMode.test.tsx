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

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
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
  const render = async (result: 'right' | 'close' | 'wrong' | 'checking' | 'unknown', extra: { roundFollows?: boolean; difference?: { reason: 'homophone'; said: string; model: string; modelPinyin: string } } = {}) => {
    const { HardModeFeedback } = await import('./HardModeFeedback');
    const handlers = { onTryAgain: vi.fn(), onShowAnswer: vi.fn(), onNext: vi.fn() };
    act(() => root.render(<HardModeFeedback result={result} said="银航" spoken roundFollows={extra.roundFollows ?? true} difference={extra.difference} {...handlers} />));
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
});
