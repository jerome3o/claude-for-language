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
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { charToCodeUnitIndex, codeUnitToCharIndex, type CharId } from '@shared/calls';
import type { RemoteCaret, TextBoardSession } from '../../services/calls/textBoard';
import { explainSentenceText } from '../../api/client';
import type { SentenceBriefExplanation } from '../../types';

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

export function TextBoard({ session, placeholder }: { session: TextBoardSession; placeholder?: string }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
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
  });

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

  return (
    <div className="tb">
      <div className="tb-paper">
        <div className="tb-mirror" ref={mirrorRef} aria-hidden="true">
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
            captureSelection();
          }}
          onCompositionStart={() => session.setComposing(true)}
          onCompositionEnd={(e) => {
            const ta = e.currentTarget;
            session.setComposing(false, ta.value, caretOf(ta));
            captureSelection(); // my caret, after my composed text…
            session.flushHeld(); // …then the other person's edits that waited (the caret stays put)
          }}
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          onFocus={captureSelection}
          onBlur={() => session.clearSelection()}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
      {selected && <SelectionHelper text={selected} />}
      {session.remoteCarets.length > 0 && (
        <div className="tb-people">
          {session.remoteCarets.map((c) => (
            <span key={c.clientId} className="tb-person">
              <span className="tb-dot" style={{ background: c.color }} /> {c.name} is here
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
