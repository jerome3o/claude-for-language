/**
 * A material's Contents (shared/materials/toc.ts): the ☰ Contents button and
 * its list — a popover under the button on wider screens, a bottom sheet on
 * phones. Tapping an entry jumps to its page (in a call: through the shared
 * material_page turn, so both people go there). Used by the call's material
 * tile and the /materials/:id viewer.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CONTENTS_LABEL, currentTocIndex, type MaterialContentsSource, type MaterialTocEntry } from '@shared/materials';
import { track } from '../../services/analytics';
import './MaterialContents.css';

interface Props {
  entries: MaterialTocEntry[];
  source: MaterialContentsSource;
  /** The page on show (0-based). */
  page: number;
  onJump: (page: number) => void;
  where: 'call' | 'viewer';
  buttonClassName?: string;
}

const NARROW = '(max-width: 639px)';

/** React events bubble out of a portal to the tile (swipe / drag handlers): stopped at the backdrop. */
const contain = {
  onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onTouchStart: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onTouchMove: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onTouchEnd: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};

function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
}

export function MaterialContentsButton({ entries, source, page, onJump, where, buttonClassName = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const [narrow, setNarrow] = useState(isNarrow);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = currentTocIndex(entries, page);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Popover: under the button, kept inside the window.
  useLayoutEffect(() => {
    if (!open || narrow || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    setBox(
      below >= 240 || below >= above
        ? { top: r.bottom + 4, left, width, maxHeight: Math.max(160, below) }
        : { bottom: window.innerHeight - r.top + 4, left, width, maxHeight: Math.max(160, above) },
    );
  }, [open, narrow]);

  // The entry on show in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'center' });
  }, [open, box]);

  const toggle = () => {
    if (open) return setOpen(false);
    setNarrow(isNarrow());
    setOpen(true);
    track('material.contents_open', { where, source, entries: entries.length });
  };
  const jump = (p: number) => {
    setOpen(false);
    track('material.contents_jump', { where, source });
    onJump(p);
  };

  const list = (
    <div className="mc-list" ref={listRef} role="list" data-testid="material-contents-list">
      {source === 'pages' && <p className="mc-note">No chapters in this file — its pages by their first line.</p>}
      {entries.map((e, i) => (
        <button
          key={`${i}-${e.page}`}
          type="button"
          role="listitem"
          className={`mc-row level-${e.level}${i === current ? ' current' : ''}`}
          aria-current={i === current ? 'true' : undefined}
          onClick={() => jump(e.page)}
          data-testid="material-contents-row"
        >
          <span className="mc-title">{e.title}</span>
          <span className="mc-page">{e.page + 1}</span>
        </button>
      ))}
    </div>
  );

  const panel = narrow ? (
    <div className="mc-backdrop sheet" onClick={() => setOpen(false)} {...contain}>
      <div className="mc-panel sheet" role="dialog" aria-label={CONTENTS_LABEL} onClick={(e) => e.stopPropagation()} data-testid="material-contents-panel">
        <div className="mc-head">
          <h2>{CONTENTS_LABEL}</h2>
          <button type="button" className="mc-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        {list}
      </div>
    </div>
  ) : (
    box && (
      <div className="mc-backdrop" onClick={() => setOpen(false)} {...contain}>
        <div className="mc-panel popover" style={box} role="dialog" aria-label={CONTENTS_LABEL} onClick={(e) => e.stopPropagation()} data-testid="material-contents-panel">
          {list}
        </div>
      </div>
    )
  );

  if (entries.length === 0) return null;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`mc-btn ${buttonClassName}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${CONTENTS_LABEL} — jump to a section`}
        data-testid="material-contents"
      >
        <span aria-hidden="true">☰</span>
        <span className="mc-label"> {CONTENTS_LABEL}</span>
      </button>
      {open && panel && createPortal(panel, document.body)}
    </>
  );
}
