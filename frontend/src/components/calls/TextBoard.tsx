/**
 * The call's text board: one document both people type into at once, like a
 * shared doc. My edits go out as CRDT ops (services/calls/textBoard.ts); the
 * other person's caret and selection show in their colour with their name.
 *
 * How it's drawn: a normal <textarea> (so every keyboard, IME, spell checker
 * and paste works) over a "mirror" with exactly the same text layout, whose
 * text is invisible and which paints the other person's selection and caret.
 * During a pinyin composition nothing is sent and incoming edits wait
 * (compositionstart → compositionend), so the IME window is never disturbed.
 *
 * Select Chinese text to see its pinyin (on the device) and, online, a
 * word-by-word meaning.
 *
 * Tab-complete (useBoardGloss): pause after typing Chinese and a grey
 * " - pīnyīn - meaning" appears after the caret — Tab accepts, typing on or
 * Esc dismisses; on a touch screen a "⇥ pīnyīn - meaning" chip under the caret
 * accepts on tap. Only the typist sees it; accepted text is ordinary board text.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { charToCodeUnitIndex, codeUnitToCharIndex, glossChipLabel, type CharId } from '@shared/calls';
import type { RemoteCaret, TextBoardSession } from '../../services/calls/textBoard';
import { boardGlossEnabled, fetchBoardGloss, setBoardGlossEnabled } from '../../services/calls/boardGloss';
import { explainSentenceText } from '../../api/client';
import type { SentenceBriefExplanation } from '../../types';
import { useBoardGloss, type GlossFetcher, type GlossSuggestion } from './useBoardGloss';

interface Decoration {
  caret: RemoteCaret;
  start: number;
  end: number;
  head: number;
}

const HAN = /[㐀-鿿豈-﫿]/;

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The mirror's content: the text in segments, other people's selections tinted, their carets as flags. */
function MirrorContent({ text, decorations }: { text: string; decorations: Decoration[] }) {
  const chars = Array.from(text);
  const points = new Set<number>([0, chars.length]);
  for (const d of decorations) {
    points.add(d.start);
    points.add(d.end);
    points.add(d.head);
  }
  const cuts = [...points].filter((p) => p >= 0 && p <= chars.length).sort((a, b) => a - b);
  const out: JSX.Element[] = [];
  for (let k = 0; k < cuts.length; k++) {
    const at = cuts[k];
    for (const d of decorations) {
      if (d.head === at) {
        out.push(
          <span key={`c-${d.caret.clientId}-${at}`} className="tb-caret" style={{ borderColor: d.caret.color }} data-testid="remote-caret">
            <span className="tb-flag" style={{ background: d.caret.color }}>{d.caret.name}</span>
          </span>,
        );
      }
    }
    if (k === cuts.length - 1) break;
    const seg = chars.slice(at, cuts[k + 1]).join('');
    const cover = decorations.find((d) => d.start <= at && cuts[k + 1] <= d.end && d.start !== d.end);
    out.push(
      cover ? (
        <span key={`s-${at}`} className="tb-sel" style={{ background: hexToRgba(cover.caret.color, 0.22) }}>{seg}</span>
      ) : (
        <Fragment key={`s-${at}`}>{seg}</Fragment>
      ),
    );
  }
  out.push(<Fragment key="end">{'​'}</Fragment>);
  return <>{out}</>;
}

function SelectionHelper({ text }: { text: string }) {
  const [py, setPy] = useState<string | null>(null);
  const [explained, setExplained] = useState<SentenceBriefExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setExplained(null);
    setError(null);
    void import('pinyin-pro').then(({ pinyin }) => {
      if (alive) setPy(pinyin(text, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' }));
    });
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div className="tb-helper" data-testid="text-board-helper">
      <span className="tb-helper-hanzi" lang="zh">{text}</span>
      {py && <span className="tb-helper-pinyin">{py}</span>}
      {explained ? (
        <span className="tb-helper-gloss">{explained.words.map((w) => `${w.hanzi} ${w.gloss}`).join(' · ')}</span>
      ) : (
        <button
          type="button"
          className="tb-helper-btn"
          disabled={busy || !navigator.onLine}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setExplained(await explainSentenceText({ hanzi: text }));
            } catch {
              setError('Couldn’t look it up');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '…' : 'Meaning'}
        </button>
      )}
      {error && <span className="tb-helper-error">{error}</span>}
    </div>
  );
}

/**
 * The ghost: a third layer over the textarea with the same layout — the text up
 * to the caret (invisible) and then the suggestion in grey on white, so it
 * reads cleanly even when it wraps over a line below. Nothing after the caret
 * is laid out here, so nothing else on the board moves.
 */
function GhostLayer({
  before,
  suggestion,
  showKey,
  layerRef,
  ghostRef,
}: {
  before: string;
  suggestion: GlossSuggestion;
  showKey: boolean;
  layerRef: RefObject<HTMLDivElement>;
  ghostRef: RefObject<HTMLSpanElement>;
}) {
  return (
    <div className="tb-mirror tb-ghost-layer" ref={layerRef} aria-hidden="true" lang="zh">
      {before}
      <span className="tb-ghost" ref={ghostRef} data-testid="text-board-ghost">
        {suggestion.text}
        {showKey && <kbd className="tb-ghost-key">Tab</kbd>}
      </span>
    </div>
  );
}

export function TextBoard({
  session,
  placeholder,
  gloss,
}: {
  session: TextBoardSession;
  placeholder?: string;
  /** Tab-complete for this call (off when absent). */
  gloss?: { callId: string; userId: string; fetchGloss?: GlossFetcher };
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const ghostLayerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [glossOn, setGlossOn] = useState(() => (gloss ? boardGlossEnabled(gloss.userId) : false));
  const [menuOpen, setMenuOpen] = useState(false);
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  const [chipPos, setChipPos] = useState<{ left: number; top: number } | null>(null);
  const [, setVersion] = useState(0);
  const mySel = useRef<{ a: CharId | null; b: CharId | null; backwards: boolean }>({ a: null, b: null, backwards: false });
  const [selected, setSelected] = useState('');
  const lastSent = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Remember my selection as anchors (stable while the other person edits). */
  const captureSelection = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const v = ta.value;
    const s = codeUnitToCharIndex(v, ta.selectionStart);
    const e = codeUnitToCharIndex(v, ta.selectionEnd);
    mySel.current = { a: session.anchorAt(s), b: session.anchorAt(e), backwards: ta.selectionDirection === 'backward' };
    const sel = v.slice(ta.selectionStart, ta.selectionEnd);
    setSelected(sel.length > 0 && sel.length <= 60 && HAN.test(sel) ? sel : '');
    // Tell the other side (throttled ~12/s, always the latest).
    const send = () => {
      lastSent.current = Date.now();
      sendTimer.current = null;
      if (document.activeElement === ta) session.sendSelection(s, e, mySel.current.backwards);
    };
    if (sendTimer.current) clearTimeout(sendTimer.current);
    const wait = 80 - (Date.now() - lastSent.current);
    if (wait <= 0) send();
    else sendTimer.current = setTimeout(send, wait);
  }, [session]);

  const callId = gloss?.callId;
  const customFetch = gloss?.fetchGloss;
  const fetchGloss = useMemo<GlossFetcher | null>(
    () => customFetch ?? (callId ? (segment, signal) => fetchBoardGloss(callId, segment, signal) : null),
    [callId, customFetch],
  );
  const suggest = useBoardGloss({
    taRef,
    isComposing: () => session.isComposing,
    enabled: glossOn,
    fetchGloss,
    onInserted: () => {
      const ta = taRef.current;
      if (!ta) return;
      session.localEdit(ta.value, codeUnitToCharIndex(ta.value, ta.selectionEnd));
      captureSelection();
    },
  });
  const suggestion = suggest.suggestion;
  const pokeRef = useRef(suggest.poke);
  pokeRef.current = suggest.poke;

  // Session changes: remote edits rewrite the textarea (keeping my caret); carets just re-render.
  useEffect(() => {
    const unsub = session.subscribe((reason) => {
      const ta = taRef.current;
      if (ta && (reason === 'remote' || reason === 'load') && !session.isComposing && ta.value !== session.text) {
        const focused = document.activeElement === ta;
        const { a, b, backwards } = mySel.current;
        const scroll = ta.scrollTop;
        ta.value = session.text;
        if (focused) {
          const text = ta.value;
          const s = charToCodeUnitIndex(text, session.indexOf(a));
          const e = charToCodeUnitIndex(text, session.indexOf(b));
          ta.setSelectionRange(Math.min(s, e), Math.max(s, e), backwards ? 'backward' : 'forward');
        }
        ta.scrollTop = scroll;
        if (focused) pokeRef.current(); // a suggestion for text that moved is dropped
      }
      setVersion(session.version);
    });
    if (taRef.current && taRef.current.value !== session.text) taRef.current.value = session.text;
    return () => {
      unsub();
    };
  }, [session]);

  useEffect(() => () => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (mirrorRef.current && taRef.current) mirrorRef.current.scrollTop = taRef.current.scrollTop;
    if (ghostLayerRef.current && taRef.current) ghostLayerRef.current.scrollTop = taRef.current.scrollTop;
  });

  // The touch chip sits just under the caret's line (above it near the bottom), inside the board.
  useLayoutEffect(() => {
    if (!suggestion || !touch) {
      setChipPos(null);
      return;
    }
    const paper = paperRef.current;
    const ghost = ghostRef.current;
    const chip = chipRef.current;
    if (!paper || !ghost || !chip) return;
    const p = paper.getBoundingClientRect();
    const r = ghost.getClientRects()[0] ?? ghost.getBoundingClientRect();
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    const left = Math.max(8, Math.min(r.left - p.left, p.width - w - 8));
    let top = r.bottom - p.top + 6;
    if (top + h > p.height - 4) top = Math.max(4, r.top - p.top - h - 6);
    setChipPos((old) => (old && old.left === left && old.top === top ? old : { left, top }));
  }, [suggestion, touch, session.version]);

  const text = session.text;
  const decorations: Decoration[] = useMemo(
    () =>
      session.remoteCarets.map((caret) => {
        const a = session.indexOf(caret.sel.anchor);
        const h = session.indexOf(caret.sel.head);
        return { caret, start: Math.min(a, h), end: Math.max(a, h), head: h };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, session.version],
  );

  const caretOf = (ta: HTMLTextAreaElement) => codeUnitToCharIndex(ta.value, ta.selectionEnd);
  const onCaret = () => {
    captureSelection();
    suggest.poke();
  };
  const ghostBefore = suggestion && taRef.current ? taRef.current.value.slice(0, charToCodeUnitIndex(taRef.current.value, suggestion.end)) : '';

  return (
    <div className="tb">
      <div className="tb-paper" ref={paperRef}>
        <div className="tb-mirror" ref={mirrorRef} aria-hidden="true" lang="zh">
          <MirrorContent text={text} decorations={decorations} />
        </div>
        <textarea
          ref={taRef}
          className="tb-input"
          lang="zh"
          spellCheck={false}
          placeholder={placeholder ?? 'Type here — you both see it as you write. Pinyin input works.'}
          data-testid="text-board"
          defaultValue={text}
          onInput={(e) => {
            const ta = e.currentTarget;
            if ((e.nativeEvent as InputEvent).isComposing || session.isComposing) return;
            session.localEdit(ta.value, caretOf(ta));
            onCaret();
          }}
          onCompositionStart={() => {
            session.setComposing(true);
            suggest.clear(); // never while the IME is open
          }}
          onCompositionEnd={(e) => {
            const ta = e.currentTarget;
            session.setComposing(false, ta.value, caretOf(ta));
            captureSelection(); // my caret, after my composed text…
            session.flushHeld(); // …then the other person's edits that waited (the caret stays put)
            suggest.poke(); // …and the pause that may bring a suggestion starts now
          }}
          onKeyDown={(e) => {
            if (!suggestion || e.nativeEvent.isComposing || session.isComposing) return;
            if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              if (suggest.accept()) e.preventDefault();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              suggest.dismiss();
            }
          }}
          onPointerDown={(e) => setTouch(e.pointerType === 'touch' || e.pointerType === 'pen')}
          onSelect={onCaret}
          onKeyUp={onCaret}
          onMouseUp={onCaret}
          onFocus={onCaret}
          onBlur={() => {
            session.clearSelection();
            suggest.clear();
          }}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
            if (ghostLayerRef.current) ghostLayerRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
        {suggestion && <GhostLayer before={ghostBefore} suggestion={suggestion} showKey={!touch} layerRef={ghostLayerRef} ghostRef={ghostRef} />}
        {suggestion && touch && (
          <button
            type="button"
            ref={chipRef}
            className="tb-gloss-chip"
            style={chipPos ? { left: chipPos.left, top: chipPos.top } : { left: 8, top: 8, visibility: 'hidden' }}
            data-testid="text-board-gloss-chip"
            // Keep the keyboard up: don't take focus from the textarea.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => suggest.accept()}
            aria-label={`Add ${suggestion.gloss.pinyin} - ${suggestion.gloss.english}`}
          >
            {glossChipLabel(suggestion.gloss)}
          </button>
        )}
      </div>
      {selected && <SelectionHelper text={selected} />}
      {(session.remoteCarets.length > 0 || gloss) && (
        <div className="tb-people">
          {session.remoteCarets.map((c) => (
            <span key={c.clientId} className="tb-person">
              <span className="tb-dot" style={{ background: c.color }} /> {c.name} is here
            </span>
          ))}
          {gloss && (
            <span className="tb-menu-wrap">
              <button type="button" className="tb-menu-btn" aria-label="Board options" aria-expanded={menuOpen} data-testid="text-board-menu" onClick={() => setMenuOpen((o) => !o)}>
                ⋯
              </button>
              {menuOpen && (
                <div className="tb-menu" role="menu">
                  <label className="tb-menu-item">
                    <input
                      type="checkbox"
                      checked={glossOn}
                      data-testid="text-board-gloss-toggle"
                      onChange={(e) => {
                        setGlossOn(e.target.checked);
                        setBoardGlossEnabled(gloss.userId, e.target.checked);
                      }}
                    />
                    <span>
                      Suggest pinyin &amp; meaning
                      <small>After you type Chinese, Tab (or tap ⇥) adds “ - pīnyīn - meaning”</small>
                    </span>
                  </label>
                </div>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
