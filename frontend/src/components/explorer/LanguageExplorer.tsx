import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { breadcrumbTrail, buildDrill, itemKey, type DrillQuestion, type DrillTarget, type ExplorerItem } from '@shared/explorer';
import type { CharWord } from '@shared/chars';
import { track } from '../../services/analytics';
import { DrillView } from './DrillView';
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
  // A quick drill over the current view (practice only; analytics, never review events).
  const [drill, setDrill] = useState<{ key: string; target: DrillTarget; pool: CharWord[]; questions: DrillQuestion[]; startedAt: number } | null>(null);
  const startDrill = (target: DrillTarget, pool: CharWord[], seed = Date.now() % 2147483647) => {
    const questions = buildDrill(target, pool, seed);
    if (questions.length === 0) return;
    track('explorer.drill_start', { kind: target.kind, items: questions.length });
    setDrill({ key: itemKey(top), target, pool, questions, startedAt: Date.now() });
  };
  const drilling = drill && drill.key === itemKey(top) ? drill : null;
  // Moving in the stack ends a drill.
  useEffect(() => {
    setDrill(null);
  }, [stack]);
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
            {drilling ? (
              <DrillView
                key={drilling.startedAt}
                questions={drilling.questions}
                onFinish={(correct) =>
                  track('explorer.drill_finish', {
                    kind: drilling.target.kind,
                    items: drilling.questions.length,
                    correct,
                    duration_ms: Date.now() - drilling.startedAt,
                  })
                }
                onAgain={() => startDrill(drilling.target, drilling.pool)}
                onExit={() => setDrill(null)}
              />
            ) : top.kind === 'char' ? (
              <CharacterView char={top.char} cardHanzi={options.cardHanzi} onWrite={options.onWrite} onClose={onClose} onDrill={startDrill} />
            ) : (
              <WordView item={top} cardHanzi={options.cardHanzi} onClose={onClose} footer={footer} onDrill={startDrill} />
            )}
          </ExplorerInside>
        </div>
        <div className="xp-foot" ref={setFooter} hidden={!!drilling} />
      </div>
    </div>,
    document.body,
  );
}
