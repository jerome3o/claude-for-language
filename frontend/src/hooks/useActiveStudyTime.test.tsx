import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useActiveStudyTime } from './useActiveStudyTime';
import { _resetStudyTime, deviceActiveMsToday } from '../services/studyTime';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), putStudyTime: vi.fn(async () => []) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useActiveStudyTime(true);
  return null;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useActiveStudyTime', () => {
  const T = new Date('2026-09-29T09:00:00').getTime();
  beforeEach(() => {
    localStorage.clear();
    _resetStudyTime();
    vi.useFakeTimers();
    vi.setSystemTime(T);
    setVisibility('visible');
  });
  afterEach(() => vi.useRealTimers());

  it('counts taps on the study screen, pauses when hidden, stops when leaving', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness />)); // opening Study is an interaction
    vi.setSystemTime(T + 20_000);
    window.dispatchEvent(new Event('pointerdown'));
    vi.setSystemTime(T + 30_000);
    setVisibility('hidden'); // screen off / app backgrounded
    expect(deviceActiveMsToday(T + 30_000)).toBe(30_000);
    vi.setSystemTime(T + 600_000);
    window.dispatchEvent(new Event('pointerdown')); // nothing counts while hidden
    expect(deviceActiveMsToday(T + 600_000)).toBe(30_000);
    setVisibility('visible'); // back: counts again from here
    vi.setSystemTime(T + 610_000);
    await act(async () => root.unmount()); // left Study
    expect(deviceActiveMsToday(T + 900_000)).toBe(40_000);
  });

  it('idle on the card: only the cut-off counts', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness />));
    vi.setSystemTime(T + 5 * 60_000);
    await act(async () => root.unmount());
    expect(deviceActiveMsToday(T + 5 * 60_000)).toBe(75_000);
  });
});
