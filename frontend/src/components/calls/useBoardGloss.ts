/**
 * Tab-complete for the call's text board. After a pause of GLOSS_DEBOUNCE_MS
 * with no typing and no IME composition, if the caret sits after Chinese at
 * the end of a line (findGlossSegment, shared/calls/gloss.ts), ask for its
 * pinyin + meaning and offer ` - pīnyīn - meaning` as ghost text. Only the
 * typist sees it; accepting types it in like any edit, so it reaches the other
 * person through the CRDT and ends up in the saved board text.
 *
 * Any change (typing, caret move, the other person's edit, composition start)
 * drops a suggestion that no longer fits, aborts a request in flight and waits
 * for the next pause; a reply for text that has changed meanwhile is ignored.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { GLOSS_DEBOUNCE_MS, charToCodeUnitIndex, codeUnitToCharIndex, findGlossSegment, formatGloss, type Gloss, type GlossCheck } from '@shared/calls';

export interface GlossSuggestion {
  segment: string;
  /** Caret (character index) the suggestion belongs after. */
  end: number;
  gloss: Gloss;
  /** What Tab inserts: " - pīnyīn - meaning". */
  text: string;
}

export type GlossFetcher = (segment: string, signal: AbortSignal) => Promise<Gloss | null>;

export function useBoardGloss(opts: {
  taRef: RefObject<HTMLTextAreaElement>;
  isComposing: () => boolean;
  enabled: boolean;
  fetchGloss: GlossFetcher | null;
  /** Called after an insert that didn't fire an input event (the fallback path). */
  onInserted: () => void;
}) {
  const { taRef } = opts;
  const [suggestion, setSuggestionState] = useState<GlossSuggestion | null>(null);
  const sugRef = useRef<GlossSuggestion | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const dismissed = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  const setSuggestion = useCallback((s: GlossSuggestion | null) => {
    sugRef.current = s;
    setSuggestionState(s);
  }, []);

  const check = useCallback((): GlossCheck | null => {
    const ta = taRef.current;
    if (!ta) return null;
    const v = ta.value;
    return findGlossSegment(v, codeUnitToCharIndex(v, ta.selectionStart), codeUnitToCharIndex(v, ta.selectionEnd), latest.current.isComposing());
  }, [taRef]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inflight.current?.abort();
    inflight.current = null;
  }, []);

  const evaluate = useCallback(async () => {
    timer.current = null;
    const ta = taRef.current;
    const { enabled, fetchGloss } = latest.current;
    if (!enabled || !fetchGloss || !ta || document.activeElement !== ta) return;
    const c = check();
    if (!c?.ok || dismissed.current === `${c.segment}@${c.end}`) return;
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    const gloss = await fetchGloss(c.segment, ac.signal).catch(() => null);
    if (ac.signal.aborted || inflight.current !== ac) return;
    inflight.current = null;
    if (!gloss) return;
    // Stale? The text or caret moved while we waited.
    const now = check();
    if (!now?.ok || now.segment !== c.segment || now.end !== c.end || document.activeElement !== ta || !latest.current.enabled) return;
    setSuggestion({ segment: c.segment, end: c.end, gloss, text: formatGloss(gloss) });
  }, [check, setSuggestion, taRef]);

  /** Something changed: keep a suggestion that still fits, else drop it and wait for the next pause. */
  const poke = useCallback(() => {
    const c = check();
    const cur = sugRef.current;
    if (cur && c?.ok && c.segment === cur.segment && c.end === cur.end) return;
    cancel();
    if (cur) setSuggestion(null);
    if (!c?.ok || !latest.current.enabled || !latest.current.fetchGloss) return;
    if (dismissed.current && dismissed.current !== `${c.segment}@${c.end}`) dismissed.current = null;
    timer.current = setTimeout(() => void evaluate(), GLOSS_DEBOUNCE_MS);
  }, [cancel, check, evaluate, setSuggestion]);

  const clear = useCallback(() => {
    cancel();
    if (sugRef.current) setSuggestion(null);
  }, [cancel, setSuggestion]);

  /** Esc / "not this one": hidden until the text there changes. */
  const dismiss = useCallback(() => {
    const cur = sugRef.current;
    if (cur) dismissed.current = `${cur.segment}@${cur.end}`;
    clear();
  }, [clear]);

  /** Tab / the chip: type the suggestion in at the caret. */
  const accept = useCallback((): boolean => {
    const ta = taRef.current;
    const s = sugRef.current;
    if (!ta || !s) return false;
    const c = check();
    if (!c?.ok || c.segment !== s.segment || c.end !== s.end) {
      clear();
      return false;
    }
    clear();
    const pos = charToCodeUnitIndex(ta.value, s.end);
    if (document.activeElement !== ta) ta.focus();
    ta.setSelectionRange(pos, pos);
    let inserted = false;
    try {
      // Goes through the browser's editing path: undo works, and the input event
      // makes the board send it like any typing.
      inserted = document.execCommand('insertText', false, s.text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      ta.setRangeText(s.text, pos, pos, 'end');
      latest.current.onInserted();
    }
    return true;
  }, [check, clear, taRef]);

  useEffect(() => {
    if (!opts.enabled) clear();
  }, [opts.enabled, clear]);

  useEffect(() => () => cancel(), [cancel]);

  return { suggestion, poke, clear, dismiss, accept };
}
