import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { explorerReducer, type ExplorerItem } from '@shared/explorer';
import { track } from '../../services/analytics';
import { LanguageExplorer } from './LanguageExplorer';

/** Where the explorer was opened from (analytics `explorer.open` source). */
export type ExplorerSource = 'study' | 'homework' | 'reader' | 'chat' | 'breakdown' | 'coach' | 'lesson' | 'card_hub' | 'other';

export interface ExplorerOpenOptions {
  source: ExplorerSource;
  /** The card on screen: its word(s) are highlighted first in "Words with 字". */
  cardHanzi?: string | null;
  /** "✍️ Write it" on a Character view (the study card opens its own writing pad). */
  onWrite?: (char: string) => void;
}

export interface ExplorerApi {
  /** A fresh stack with this view (a tap outside the explorer). */
  open: (item: ExplorerItem, opts: ExplorerOpenOptions) => void;
  /** Another view on the stack (a tap inside a view). */
  push: (item: ExplorerItem) => void;
  /** True inside the explorer's own views: taps push instead of opening. */
  inside: boolean;
}

const NOOP: ExplorerApi = { open: () => {}, push: () => {}, inside: false };
const ExplorerCtx = createContext<ExplorerApi | null>(null);

/** The explorer of this part of the tree (a no-op outside the provider, e.g. in unit tests). */
export function useExplorer(): ExplorerApi {
  return useContext(ExplorerCtx) ?? NOOP;
}

/** Inside a view: the same API with `inside` set, so ExplorableText pushes. */
export function ExplorerInside({ api, children }: { api: ExplorerApi; children: ReactNode }) {
  const value = useMemo(() => ({ ...api, inside: true }), [api]);
  return <ExplorerCtx.Provider value={value}>{children}</ExplorerCtx.Provider>;
}

/**
 * The language explorer (docs/LANGUAGE_EXPLORER.md): one bottom sheet holding a stack of
 * Character / Word views (shared/explorer/stack.ts), mounted once for the whole app.
 */
export function ExplorerProvider({ children }: { children: ReactNode }) {
  const [stack, dispatch] = useReducer(explorerReducer, []);
  const opts = useRef<ExplorerOpenOptions>({ source: 'other' });
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const open = useCallback((item: ExplorerItem, o: ExplorerOpenOptions) => {
    opts.current = o;
    track('explorer.open', { source: o.source, kind: item.kind });
    dispatch({ type: 'open', item });
  }, []);

  const push = useCallback((item: ExplorerItem) => {
    const cur = stackRef.current;
    const top = cur[cur.length - 1];
    track('explorer.push', { kind: item.kind, from: top?.kind ?? 'none', depth: cur.length + 1 });
    dispatch({ type: 'push', item });
  }, []);

  const api = useMemo<ExplorerApi>(() => ({ open, push, inside: false }), [open, push]);

  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length]);

  return (
    <ExplorerCtx.Provider value={api}>
      {children}
      {stack.length > 0 && (
        <LanguageExplorer
          stack={stack}
          api={api}
          options={opts.current}
          onBack={() => dispatch({ type: 'pop' })}
          onCrumb={(index) => dispatch({ type: 'popTo', index })}
          onClose={() => dispatch({ type: 'close' })}
        />
      )}
    </ExplorerCtx.Provider>
  );
}
