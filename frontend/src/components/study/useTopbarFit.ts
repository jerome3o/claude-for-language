import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** How tight the study top bar is: 0 = everything at full size … TOPBAR_FIT_MAX = icon-only chips + the smallest counts. */
export const TOPBAR_FIT_MAX = 3;

/**
 * The study top bar's counts NEVER wrap or get cut (Jerome, Pixel Fold folded: "132" broke onto two
 * lines once the 🎯 chip joined the bar): while the counts overflow their box the bar steps up a
 * level — 1: the 🎯 / ✈ chips go icon-only (the state as a dot / colour, the label stays their
 * accessible name) and the sync badge drops its word; 2 and 3: the numbers get smaller. Back to 0
 * whenever the width or what the bar holds changes, then up again as far as needed.
 */
export function nextTopbarFit(level: number, overflowing: boolean): number {
  return overflowing && level < TOPBAR_FIT_MAX ? level + 1 : level;
}

/** [bar] = the top bar; its `.queue-counts` is what must fit. [content] = what the bar shows (counts, chips' states). */
export function useTopbarFit(bar: RefObject<HTMLElement>, content: string): number {
  const [level, setLevel] = useState(0);
  const [width, setWidth] = useState(0);
  // The counts' box changed (a sync badge came and went): measure again.
  const [, setTick] = useState(0);
  const lastKey = useRef('');
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) {
          const w = Math.round(entry.contentRect.width);
          setWidth((prev) => (prev === w ? prev : w));
        } else setTick((t) => t + 1);
      }
    });
    ro.observe(el);
    const counts = el.querySelector('.queue-counts');
    if (counts) ro.observe(counts);
    return () => ro.disconnect();
  }, [bar]);
  useLayoutEffect(() => {
    const key = `${width}|${content}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (level !== 0) { setLevel(0); return; }
    }
    const c = bar.current?.querySelector<HTMLElement>('.queue-counts');
    if (!c) return;
    const next = nextTopbarFit(level, c.scrollWidth > c.clientWidth + 1);
    if (next !== level) setLevel(next);
  });
  return level;
}
