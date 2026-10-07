import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { breadcrumbTrail, itemKey, type ExplorerItem } from '@shared/explorer';
import { ExplorerInside, type ExplorerApi, type ExplorerOpenOptions } from './ExplorerContext';
import { CharacterView } from './CharacterView';
import { WordView } from './WordView';
import '../chars/CharacterSheet.css';
import './explorer.css';

/**
 * The explorer sheet: ← (from the second view), the breadcrumb trail and ✕ on top, the current
 * view scrolling below with its own pinned footer. Each depth remembers its scroll position, so
 * going back lands where the learner was.
 */
export function LanguageExplorer({
  stack,
  api,
  options,
  onBack,
  onCrumb,
  onClose,
}: {
  stack: ExplorerItem[];
  api: ExplorerApi;
  options: ExplorerOpenOptions;
  onBack: () => void;
  onCrumb: (index: number) => void;
  onClose: () => void;
}) {
  const top = stack[stack.length - 1];
  const body = useRef<HTMLDivElement>(null);
  // The view's pinned actions render here (a portal), under the scrolling body: never scrolled away.
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const scrolls = useRef<number[]>([]);
  const prevDepth = useRef(stack.length);
  const direction = stack.length >= prevDepth.current ? 'push' : 'pop';

  // Leaving a depth: keep its scroll; arriving: restore it (0 for a new view).
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const depth = stack.length;
    el.scrollTop = depth < prevDepth.current ? scrolls.current[depth - 1] ?? 0 : 0;
    scrolls.current = scrolls.current.slice(0, depth);
    prevDepth.current = depth;
  }, [stack]);

  const label = top.kind === 'char' ? `The character ${top.char}` : `The word ${top.hanzi}`;
  const crumbs = breadcrumbTrail(stack);

  return createPortal(
    <div
      className="modal-overlay xp-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      data-testid="explorer"
    >
      <div className="xp-sheet" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="xp-head">
          {stack.length > 1 ? (
            <button type="button" className="xp-icon-btn" onClick={onBack} aria-label="Back" data-testid="explorer-back">
              ←
            </button>
          ) : (
            <span className="xp-icon-spacer" />
          )}
          <nav className="xp-trail" aria-label="Explorer trail">
            {crumbs.map((c, i) =>
              c.kind === 'gap' ? (
                <span key={`gap-${i}`} className="xp-crumb-gap">…</span>
              ) : (
                <span key={c.index} className="xp-crumb-wrap">
                  {i > 0 && <span className="xp-crumb-sep" aria-hidden="true">›</span>}
                  <button
                    type="button"
                    className={`xp-crumb${c.current ? ' current' : ''}`}
                    lang="zh-CN"
                    aria-current={c.current ? 'page' : undefined}
                    disabled={c.current}
                    onClick={() => onCrumb(c.index)}
                  >
                    {c.label}
                  </button>
                </span>
              ),
            )}
          </nav>
          <button type="button" className="xp-icon-btn" onClick={onClose} aria-label="Close" data-testid="explorer-close">
            ✕
          </button>
        </div>
        <div
          className={`xp-body xp-anim-${direction}`}
          ref={body}
          key={`${stack.length}:${itemKey(top)}`}
          onScroll={(e) => {
            scrolls.current[stack.length - 1] = e.currentTarget.scrollTop;
          }}
        >
          <ExplorerInside api={api}>
            {top.kind === 'char' ? (
              <CharacterView char={top.char} cardHanzi={options.cardHanzi} onWrite={options.onWrite} onClose={onClose} />
            ) : (
              <WordView item={top} cardHanzi={options.cardHanzi} onClose={onClose} footer={footer} />
            )}
          </ExplorerInside>
        </div>
        <div className="xp-foot" ref={setFooter} />
      </div>
    </div>,
    document.body,
  );
}
