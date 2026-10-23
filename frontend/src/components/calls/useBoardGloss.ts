/**
 * Tab-complete for the call's text board. After a pause of GLOSS_DEBOUNCE_MS
 * with no typing and no IME composition, if the caret sits after Chinese at
 * the end of a line (findGlossSegment, shared/calls/gloss.ts), ask for its
 * pinyin + meaning and offer ` - pīnyīn - meaning` as ghost text; after an
 * English word or short phrase, ask for the Chinese and offer
 * ` - 中文 - pīnyīn`. Only the typist sees it; accepting types it in like any
 * edit, so it reaches the other person through the CRDT and ends up in the
 * saved board text.
 *
 * Reliable first (23 Oct 2026: it worked now and then for Jerome and not at
 * all for Minghui — every edit of the other person's, every caret event,
 * restarted the wait and dropped the answer on its way, and one failure meant
 * a minute of silence):
 * - a change that leaves MY segment as it was (the other person typing
 *   elsewhere, a caret event, my line moving down) keeps the wait / the
 *   answer on its way and the suggestion shown (its position follows);
 * - for Chinese the device's own gloss (`localGloss`: pinyin, a dictionary
 *   meaning for a word) shows at once when it has a meaning, else after
 *   GLOSS_LOCAL_AFTER_MS or as soon as the server can't help — and the
 *   server's contextual gloss replaces it when it comes;
 * - each lookup reports what happened (`onLookup` → analytics).
 * A change of the segment itself drops the suggestion and waits for the next
 * pause; the request it left behind still finishes (and is cached).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  GLOSS_DEBOUNCE_MS,
  GLOSS_LOCAL_AFTER_MS,
  charToCodeUnitIndex,
  codeUnitToCharIndex,
  findGlossSegment,
  formatGloss,
  type AnyGloss,
  type GlossCheck,
  type GlossDirection,
  type GlossOutcome,
} from '@shared/calls';

export type GlossSource = 'server' | 'local';

export interface GlossSuggestion {
  segment: string;
  /** Caret (character index) the suggestion belongs after. */
  end: number;
  /** 'zh': Chinese typed → { pinyin, english }; 'en': English typed → { chinese, pinyin }. */
  direction: GlossDirection;
  gloss: AnyGloss;
  /** What Tab inserts: " - pīnyīn - meaning" / " - 中文 - pīnyīn" / " - pīnyīn" (device, no meaning). */
  text: string;
  /** 'local' = the device's own (shown until the server's comes). */
  source: GlossSource;
}

export interface GlossFetchResult {
  gloss: AnyGloss | null;
  outcome: GlossOutcome;
  status: number;
}

/** The server lookup: a result with its outcome, or (tests) just the gloss / null. */
export type GlossFetcher = (segment: string, signal: AbortSignal, direction: GlossDirection) => Promise<GlossFetchResult | AnyGloss | null>;
/** The device's own gloss of a Chinese segment (null = none). */
export type LocalGlossFetcher = (segment: string) => Promise<AnyGloss | null>;

/** One lookup, for the `call.board_gloss_lookup` analytics event (no text in it). */
export interface GlossLookupReport {
  direction: GlossDirection;
  outcome: GlossOutcome;
  status: number;
  /** Until the server's answer (or the failure). */
  ms: number;
  /** What the typist got: the server's gloss, the device's, or nothing. */
  shown: GlossSource | 'none';
}

function normalize(r: GlossFetchResult | AnyGloss | null): GlossFetchResult {
  if (r && typeof r === 'object' && 'outcome' in r) return r;
  return r ? { gloss: r as AnyGloss, outcome: 'server', status: 0 } : { gloss: null, outcome: 'failed', status: 0 };
}

/** The fetcher's answer, or 'superseded' as soon as the wait is called off (whatever the fetcher does with the signal). */
function untilAborted(p: Promise<GlossFetchResult | AnyGloss | null>, signal: AbortSignal): Promise<GlossFetchResult> {
  const superseded: GlossFetchResult = { gloss: null, outcome: 'superseded', status: 0 };
  if (signal.aborted) return Promise.resolve(superseded);
  return new Promise((resolve) => {
    const onAbort = () => resolve(superseded);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (r) => {
        signal.removeEventListener('abort', onAbort);
        resolve(normalize(r));
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(normalize(null));
      },
    );
  });
}

const keyOf = (c: { direction: GlossDirection; segment: string }) => `${c.direction}:${c.segment}`;

export function useBoardGloss(opts: {
  taRef: RefObject<HTMLTextAreaElement>;
  isComposing: () => boolean;
  enabled: boolean;
  fetchGloss: GlossFetcher | null;
  /** The device's own gloss for Chinese, shown while the server's is on its way (null = none). */
  localGloss?: LocalGlossFetcher | null;
  /** Called after an insert that didn't fire an input event (the fallback path). */
  onInserted: () => void;
  /** Each settled lookup (analytics). */
  onLookup?: (r: GlossLookupReport) => void;
}) {
  const { taRef } = opts;
  const [suggestion, setSuggestionState] = useState<GlossSuggestion | null>(null);
  const sugRef = useRef<GlossSuggestion | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  /** The segment a wait or a lookup is running for (direction:segment). */
  const pendingKey = useRef<string | null>(null);
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
    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = null;
    inflight.current?.abort();
    inflight.current = null;
    pendingKey.current = null;
  }, []);

  const evaluate = useCallback(async () => {
    timer.current = null;
    const ta = taRef.current;
    const { enabled, fetchGloss } = latest.current;
    const c = check();
    if (!enabled || !fetchGloss || !ta || document.activeElement !== ta || !c?.ok || dismissed.current === keyOf(c)) {
      pendingKey.current = null;
      return;
    }
    const { segment, direction } = c;
    pendingKey.current = keyOf(c);
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    const started = Date.now();
    let serverState: 'pending' | 'ok' | 'failed' = 'pending';

    /** Show `gloss` if the caret is still after the same segment; its place follows the text. */
    const show = (gloss: AnyGloss, source: GlossSource): boolean => {
      if (ac.signal.aborted || inflight.current !== ac || !latest.current.enabled || document.activeElement !== ta) return false;
      const now = check();
      if (!now?.ok || now.segment !== segment || now.direction !== direction) return false;
      setSuggestion({ segment, end: now.end, direction, gloss, text: formatGloss(gloss), source });
      return true;
    };

    // The device's own gloss: at once with a meaning, else after a short wait — unless the server's came first.
    const localFetch = direction === 'zh' ? latest.current.localGloss : null;
    const localP: Promise<AnyGloss | null> = localFetch ? localFetch(segment).catch(() => null) : Promise.resolve(null);
    let localShown = false;
    void localP.then((lg) => {
      if (!lg || serverState !== 'pending' || ac.signal.aborted) return;
      const hasMeaning = !('english' in lg) || lg.english !== '';
      const wait = (hasMeaning ? 0 : GLOSS_LOCAL_AFTER_MS) - (Date.now() - started);
      const showIt = () => {
        localTimer.current = null;
        if (serverState === 'pending' && show(lg, 'local')) localShown = true;
      };
      if (wait <= 0) showIt();
      else localTimer.current = setTimeout(showIt, wait);
    });

    const r = await untilAborted(fetchGloss(segment, ac.signal, direction), ac.signal);
    serverState = r.gloss ? 'ok' : 'failed';
    const ms = Date.now() - started;
    const report = (shown: GlossLookupReport['shown'], outcome = r.outcome) =>
      latest.current.onLookup?.({ direction, outcome, status: r.status, ms, shown });
    if (ac.signal.aborted || inflight.current !== ac) {
      report('none', 'superseded');
      return;
    }
    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = null;
    if (r.gloss && show(r.gloss, 'server')) {
      inflight.current = null;
      pendingKey.current = null;
      report('server');
      return;
    }
    // The server couldn't help (or answered for text that has moved on): the device's gloss, if any.
    const lg = localShown ? null : await localP;
    if (!localShown && lg && show(lg, 'local')) localShown = true;
    if (inflight.current === ac) {
      inflight.current = null;
      pendingKey.current = null;
    }
    report(localShown ? 'local' : 'none');
  }, [check, setSuggestion, taRef]);

  /** Something changed: keep what still fits my segment, else drop it and wait for the next pause. */
  const poke = useCallback(() => {
    const c = check();
    const cur = sugRef.current;
    if (cur && c?.ok && c.segment === cur.segment && c.direction === cur.direction) {
      // Same segment (the other person typed elsewhere, my line moved): it stays, at the new place.
      if (c.end !== cur.end) setSuggestion({ ...cur, end: c.end });
      return;
    }
    // Same segment still waiting / on its way: let it be.
    if (c?.ok && !cur && pendingKey.current === keyOf(c) && latest.current.enabled) return;
    cancel();
    if (cur) setSuggestion(null);
    if (!c?.ok || !latest.current.enabled || !latest.current.fetchGloss) return;
    if (dismissed.current && dismissed.current !== keyOf(c)) dismissed.current = null;
    pendingKey.current = keyOf(c);
    timer.current = setTimeout(() => void evaluate(), GLOSS_DEBOUNCE_MS);
  }, [cancel, check, evaluate, setSuggestion]);

  const clear = useCallback(() => {
    cancel();
    if (sugRef.current) setSuggestion(null);
  }, [cancel, setSuggestion]);

  /** Esc / "not this one": hidden until the text there changes. */
  const dismiss = useCallback(() => {
    const cur = sugRef.current;
    if (cur) dismissed.current = keyOf(cur);
    clear();
  }, [clear]);

  /** Tab / the chip: type the suggestion in at the caret. */
  const accept = useCallback((): boolean => {
    const ta = taRef.current;
    const s = sugRef.current;
    if (!ta || !s) return false;
    const c = check();
    if (!c?.ok || c.segment !== s.segment || c.direction !== s.direction) {
      clear();
      return false;
    }
    clear();
    const pos = charToCodeUnitIndex(ta.value, c.end);
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
