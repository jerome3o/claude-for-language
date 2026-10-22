/**
 * Characters & words: the Total | Per week toggle (remembered on the device, tracked), the
 * pace headline with its trend, the weekly bars (a negative week below the zero line, the
 * current week fainter) and the tap-to-inspect week line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { KnownProgress, KnownRate } from '@shared/progress';
import { KnownCountsView } from './KnownCounts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Monday 7 Sep 2026, 00:00 in London (UTC+1).
const MON = Date.parse('2026-09-06T23:00:00.000Z');
const NOW = MON + 6 * WEEK + 2 * DAY;

const rate: KnownRate = {
  weeks: Array.from({ length: 7 }, (_, i) => ({
    start_ms: MON + i * WEEK,
    end_ms: i === 6 ? NOW : MON + (i + 1) * WEEK,
    partial: i === 6,
    characters: [12, 20, -3, 25, 38, 30, 9][i],
    words: [30, 41, 8, 55, 61, 47, 12][i],
  })),
  pace: {
    characters: { per_week: 23, previous_per_week: 15, trend: 'up' },
    words: { per_week: 44, previous_per_week: 51, trend: 'down' },
  },
};

const data: KnownProgress & { rate: KnownRate } = {
  characters: { known: 1204, learning: 210 },
  words: { known: 1925, learning: 377 },
  sentences: { known: 0, learning: 0 },
  recent_characters: [],
  history: [
    { at_ms: MON, characters: { known: 1000, learning: 0 }, words: { known: 1600, learning: 0 } },
    { at_ms: NOW, characters: { known: 1204, learning: 0 }, words: { known: 1925, learning: 0 } },
  ],
  rate,
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<Parameters<typeof KnownCountsView>[0]> = {}) {
  act(() => root.render(
    <KnownCountsView data={data} explain={false} onToggleExplain={() => {}} tzOffsetMinutes={60} {...props} />,
  ));
}
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('KnownCountsView', () => {
  it('starts on Total (the totals line chart), the tiles always there', () => {
    render();
    expect(button('Total').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.known-line--chars')).not.toBeNull();
    expect(host.querySelector('.known-bar')).toBeNull();
    expect(host.textContent).toContain('1,204');
  });

  it('Per week: pace + trend, a bar per week, the negative week below zero, remembered and tracked', () => {
    render();
    act(() => button('Per week').click());
    expect(button('Per week').getAttribute('aria-pressed')).toBe('true');
    expect(track).toHaveBeenCalledWith('progress.known_mode', { mode: 'rate' });
    expect(localStorage.getItem('known-chart-mode-v1')).toBe('rate');
    expect(host.textContent).toContain('≈ 44 words / week');
    expect(host.textContent).toContain('↓ from 51');
    expect(host.textContent).toContain('≈ 23 characters / week');
    expect(host.textContent).toContain('↑ from 15');
    expect(host.querySelectorAll('.known-bar--chars')).toHaveLength(7);
    expect(host.querySelectorAll('.known-bar--words')).toHaveLength(7);
    expect(host.querySelectorAll('.known-bar--down')).toHaveLength(1);
    expect(host.querySelectorAll('.known-bar--partial')).toHaveLength(2);
    expect(host.querySelector('.known-zero')).not.toBeNull();
    expect(host.textContent).toContain('1,925'); // the totals stay on top
    act(() => button('Total').click());
    expect(track).toHaveBeenLastCalledWith('progress.known_mode', { mode: 'total' });
    expect(localStorage.getItem('known-chart-mode-v1')).toBe('total');
  });

  it('opens on the remembered mode; tapping a week shows its gains', () => {
    localStorage.setItem('known-chart-mode-v1', 'rate');
    render();
    const svg = host.querySelector('.known-rate svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, width: 340, top: 0, height: 200, right: 340, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    // Week index 4 (Monday 5 Oct): its slot centre is 36 + (296 / 7) * 4.5.
    act(() => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 36 + (296 / 7) * 4.5, bubbles: true }));
    });
    const tip = host.querySelector('.known-tooltip')!;
    expect(tip.textContent).toContain('Week of 5 Oct');
    expect(tip.textContent).toContain('+38 characters');
    expect(tip.textContent).toContain('+61 words');
  });

  it('no pace yet → says when it comes', () => {
    render({ data: { ...data, rate: { ...rate, pace: null } }, initialMode: 'rate' });
    expect(host.textContent).toContain('Your pace shows after 4 weeks of reviews.');
  });
});
