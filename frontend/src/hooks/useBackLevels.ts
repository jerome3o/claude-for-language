import { useEffect, useRef } from 'react';

/**
 * Back (the Android back gesture in the PWA / the app shell, the browser's ←) for a stack that
 * lives inside one page — the language explorer (docs/LANGUAGE_EXPLORER.md). Each level gets a
 * history entry with the SAME URL (the route never changes), so back pops ONE entry and
 * `onBackTo(level)` takes the stack down to that many levels (0 = closed).
 *
 * When levels drop from the UI instead (✕, ←, a breadcrumb, Escape), the entries are removed
 * again with `history.go(-n)` — but only while the current entry is still ours: when something
 * navigated on top meanwhile (e.g. "Open card"), the new page is never left. The popstate that
 * `history.go` fires lands on the level we already have, so it is never taken as a second back.
 */
const LEVEL = 'backLevel';
const OWNER = 'backLevelOwner';

type MarkedState = Record<string, unknown> & { [LEVEL]?: number; [OWNER]?: string };

function currentState(): MarkedState | null {
  const s = window.history.state as MarkedState | null;
  return s && typeof s === 'object' ? s : null;
}

export function useBackLevels(levels: number, onBackTo: (level: number) => void, owner = 'explorer'): void {
  const pushed = useRef(0);
  const onBackRef = useRef(onBackTo);
  onBackRef.current = onBackTo;
  // One id per mount: entries left by an earlier page / session never count as ours.
  const id = useRef(`${owner}:${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const onPop = () => {
      if (pushed.current === 0) return;
      const s = currentState();
      const level = s?.[OWNER] === id && typeof s[LEVEL] === 'number' ? s[LEVEL] : 0;
      if (level >= pushed.current) return; // forward, or the go(-n) of a UI close
      pushed.current = level;
      onBackRef.current(level);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [id]);

  useEffect(() => {
    if (levels > pushed.current) {
      for (let l = pushed.current + 1; l <= levels; l++) {
        window.history.pushState({ ...(currentState() ?? {}), [LEVEL]: l, [OWNER]: id }, '');
      }
      pushed.current = levels;
    } else if (levels < pushed.current) {
      const s = currentState();
      const onOurs = s?.[OWNER] === id && s[LEVEL] === pushed.current;
      const n = pushed.current - levels;
      pushed.current = levels;
      if (onOurs) window.history.go(-n);
    }
  }, [levels, id]);
}
