import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUpNextDrag } from '../../services/upNextDrag';
import './upNext.css';

/** One row of the list as the board shows it. */
export interface UpNextViewRow {
  noteId: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deckName: string;
  /** "New word" / "Started · 2 new cards left" (upNextStatusLabel). */
  status: string;
  /** Set when the tutor added it. */
  addedBy?: string | null;
  /** Extra action beside ✕ (the learner's "⚡ Today"). */
  extra?: ReactNode;
}

/** A search result. */
export interface UpNextSearchHit {
  noteId: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deckName: string;
  /** Already on the list. */
  onList: boolean;
  /** Every card already studied — it can't go on the list (⚡ Study it today instead). */
  studied: boolean;
  /** Shown instead of the add buttons when `studied` (e.g. a ⚡ button). */
  studiedAction?: ReactNode;
}

/**
 * The Up next list with its search: press-and-hold a row to move it, ✕ to take it off
 * (the parent shows Undo), ↑ to send it to the top; search results go on the list with
 * ＋ Top / ＋ Bottom, or press-and-hold one and drag it into its place.
 */
export function UpNextBoard(props: {
  rows: UpNextViewRow[];
  onReorder: (order: string[], how: 'drag' | 'top') => void;
  onRemove: (noteId: string) => void;
  onAdd: (noteId: string, position: 'top' | 'bottom' | number, how: 'top' | 'bottom' | 'drop') => void;
  search: (q: string) => Promise<UpNextSearchHit[]>;
  /** Shown above the list (the learner's ⚡ Today section). */
  before?: ReactNode;
  emptyText: string;
  searchPlaceholder?: string;
  /** No changes possible (offline tutor view) — the reason. */
  readOnlyReason?: string | null;
}) {
  const { rows, onReorder, onRemove, onAdd, search, before, emptyText, readOnlyReason } = props;
  const ids = useMemo(() => rows.map((r) => r.noteId), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.noteId, r])), [rows]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UpNextSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      search(query)
        .then((h) => { if (seq.current === mine) setHits(h); })
        .catch(() => { if (seq.current === mine) setHits([]); })
        .finally(() => { if (seq.current === mine) setSearching(false); });
    }, 200);
    return () => clearTimeout(t);
  }, [q, search]);

  const hitById = useMemo(() => new Map((hits ?? []).map((h) => [h.noteId, h])), [hits]);
  const drag = useUpNextDrag(
    ids,
    (order) => onReorder(order, 'drag'),
    (noteId, index) => onAdd(noteId, index, 'drop')
  );
  const readOnly = !!readOnlyReason;

  return (
    <div className="upnext-board" ref={drag.rootRef}>
      {before}

      {!readOnly && (
        <section className="upnext-section upnext-search" aria-label="Add words">
          <h2 className="upnext-section-title">＋ Add words</h2>
          <input
            type="search"
            className="form-input upnext-search-input"
            placeholder={props.searchPlaceholder ?? 'Search your cards: 银行, yinhang, bank…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search cards to add"
            data-testid="upnext-search"
          />
          {q.trim() && (
            <ul className="upnext-results" data-testid="upnext-results">
              {searching && !hits && <li className="upnext-muted">Searching…</li>}
              {hits && hits.length === 0 && !searching && <li className="upnext-muted">No card matches “{q.trim()}”.</li>}
              {hits?.map((h) => {
                const draggable = !h.onList && !h.studied;
                return (
                  <li
                    key={h.noteId}
                    className={`upnext-result${drag.dragId === h.noteId ? ' upnext-result--lifted' : ''}`}
                    data-testid="upnext-result"
                    data-note-id={h.noteId}
                    {...(draggable ? drag.resultProps(h.noteId) : {})}
                  >
                    {draggable && <span className="upnext-grip" aria-hidden="true">⠿</span>}
                    <span className="upnext-word">
                      <span className="upnext-hanzi" lang="zh">{h.hanzi}</span>
                      <span className="upnext-pinyin">{h.pinyin}</span>
                      <span className="upnext-english">{h.english}</span>
                      <span className="upnext-meta">{h.deckName}{h.studied ? ' · already studied' : ''}</span>
                    </span>
                    <span className="upnext-actions" onClickCapture={drag.guardClick}>
                      {h.onList ? (
                        <span className="upnext-on-list">✓ Up next</span>
                      ) : h.studied ? (
                        h.studiedAction ?? null
                      ) : (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm upnext-add" onClick={() => onAdd(h.noteId, 'top', 'top')} aria-label={`Add ${h.hanzi} at the top`}>
                            ＋ Top
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm upnext-add" onClick={() => onAdd(h.noteId, 'bottom', 'bottom')} aria-label={`Add ${h.hanzi} at the bottom`}>
                            ＋ Bottom
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
              {hits && hits.some((h) => !h.onList && !h.studied) && (
                <li className="upnext-muted upnext-drag-hint">Tip: press and hold a word, then drag it into its place in the list.</li>
              )}
            </ul>
          )}
        </section>
      )}
      <section className="upnext-section" aria-labelledby="upnext-list-title">
        <div className="upnext-section-head">
          <h2 id="upnext-list-title" className="upnext-section-title">↑ Up next</h2>
          <span className="upnext-count">{rows.length} {rows.length === 1 ? 'word' : 'words'}</span>
        </div>
        <p className="upnext-hint">
          Introduced first, in this order, from today’s new cards. Press and hold a word to move it.
        </p>
        {readOnlyReason && <p className="upnext-readonly">{readOnlyReason}</p>}

        <ol className={`upnext-list${drag.dragId ? ' upnext-list--dragging' : ''}`} ref={drag.listRef} data-testid="upnext-list">
          {drag.order.map((id, i) => {
            const row = byId.get(id);
            const hit = !row ? hitById.get(id) : undefined;
            if (!row && !hit) return null;
            const lifted = drag.dragId === id;
            const placeholder = !row;
            const r = row ?? { noteId: id, hanzi: hit!.hanzi, pinyin: hit!.pinyin, english: hit!.english, deckName: hit!.deckName, status: 'Drop it here' };
            return (
              <li
                key={id}
                data-upnext-row
                data-note-id={id}
                className={`upnext-row${lifted ? ' upnext-row--lifted' : ''}${placeholder ? ' upnext-row--placeholder' : ''}`}
                {...(readOnly || placeholder ? {} : drag.rowProps(id))}
              >
                <span className="upnext-pos" aria-hidden="true">{i + 1}</span>
                <span className="upnext-word">
                  <span className="upnext-hanzi" lang="zh">{r.hanzi}</span>
                  <span className="upnext-pinyin">{r.pinyin}</span>
                  <span className="upnext-english">{r.english}</span>
                  <span className="upnext-meta">
                    {r.deckName}
                    {' · '}
                    {r.status}
                    {row?.addedBy ? <span className="upnext-added-by"> · added by {row.addedBy}</span> : null}
                  </span>
                </span>
                {!placeholder && !readOnly && (
                  <span className="upnext-actions" onClickCapture={drag.guardClick}>
                    {row?.extra}
                    {i > 0 && (
                      <button
                        type="button"
                        className="upnext-icon-btn"
                        aria-label={`Move ${r.hanzi} to the top`}
                        title="Move to the top"
                        onClick={() => onReorder([id, ...ids.filter((x) => x !== id)], 'top')}
                      >
                        ↑
                      </button>
                    )}
                    <button
                      type="button"
                      className="upnext-icon-btn upnext-remove"
                      aria-label={`Take ${r.hanzi} off Up next`}
                      title="Take it off the list (the card is kept)"
                      onClick={() => onRemove(id)}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </li>
            );
          })}
          {drag.order.length === 0 && (
            <li className="upnext-empty" data-testid="upnext-empty">
              {drag.dragId ? 'Drop it here' : emptyText}
            </li>
          )}
        </ol>
      </section>

    </div>
  );
}

/** "Removed 银行 from Up next · Undo" for a few seconds. */
export function UndoToast({ text, onUndo, onDone, hideUndo }: { text: string; onUndo: () => void; onDone: () => void; hideUndo?: boolean }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return (
    <div className="upnext-toast" role="status" data-testid="upnext-toast">
      <span>{text}</span>
      {!hideUndo && <button type="button" className="upnext-toast-undo" onClick={onUndo}>Undo</button>}
    </div>
  );
}
