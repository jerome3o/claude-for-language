import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { nextFollow, type ScrollMetrics } from './followEnd';

/**
 * Keeps [endRef] on screen when the thread grows ([changeKey] changes: a new message, a reply
 * streaming in), but only while the reader is at the end (rules: ./followEnd.ts). [mine] going up
 * (my own new message) follows again. The page variant scrolls the document, a sheet its body
 * ([bodyRef]); both are watched.
 */
export function useFollowEnd(bodyRef: RefObject<HTMLElement | null>, endRef: RefObject<HTMLElement | null>, changeKey: string, mine: number, enabled = true) {
  const follow = useRef(true);
  const prevTop = useRef(new WeakMap<object, number>());

  useEffect(() => {
    const body = bodyRef.current;
    const onScroll = (target: object, m: ScrollMetrics) => {
      const prev = prevTop.current.get(target) ?? m.scrollTop;
      follow.current = nextFollow(follow.current, prev, m);
      prevTop.current.set(target, m.scrollTop);
    };
    const onBody = () => { if (body) onScroll(body, body); };
    const onWindow = () => {
      const doc = document.scrollingElement ?? document.documentElement;
      onScroll(window, { scrollTop: doc.scrollTop, clientHeight: window.innerHeight, scrollHeight: doc.scrollHeight });
    };
    body?.addEventListener('scroll', onBody, { passive: true });
    window.addEventListener('scroll', onWindow, { passive: true });
    return () => {
      body?.removeEventListener('scroll', onBody);
      window.removeEventListener('scroll', onWindow);
    };
  }, [bodyRef]);

  const lastMine = useRef(mine);
  useEffect(() => {
    if (mine > lastMine.current) follow.current = true;
    lastMine.current = mine;
  }, [mine]);

  useEffect(() => {
    if (enabled && follow.current) endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [changeKey, mine, enabled, endRef]);

  /** Follow again from here (a send). */
  return useCallback(() => { follow.current = true; }, []);
}
