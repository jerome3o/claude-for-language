import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { canAddToUpNext, upNextPausedLabel, upNextStatus, upNextStatusLabel } from '@shared/decks';
import { useRawQueueCounts } from '../hooks/useOfflineData';
import { db, type LocalNote } from '../db/database';
import { addToUpNext, localCardCounts, removeFromUpNext, reorderUpNext, useUpNextRows } from '../services/upNext';
import { bumpNotes, clearBump, useBumps } from '../services/studyBumps';
import { noteMatches, stripTones } from '../services/noteSearch';
import { searchNotesOnServer } from '../api/client';
import { addUpNextApi } from '../api/upNext';
import { syncService } from '../services/sync';
import { UndoToast, UpNextBoard, type UpNextSearchHit, type UpNextViewRow } from '../components/upNext/UpNextBoard';
import { BumpButton } from '../components/bumps/BumpButton';
import '../components/upNext/upNext.css';

const queuesOf = (c?: { fresh: number; total: number }) => (c ? Array.from({ length: c.total }, (_, i) => ({ queue: i < c.fresh ? 0 : 1 })) : []);

/**
 * "Up next" (docs/STUDY_SESSION.md "Up next"): today's ⚡ pocket, then the ordered list of
 * words introduced first within the daily budget — reorder by press-and-hold, ✕ to take one
 * off (Undo), search to add at the top / bottom or drag a result into its place. Offline-first.
 */
export function UpNextPage() {
  // "Pause new cards on heavy days" (shared/decks/review-load.ts): Up next draws from the budget, so it waits too.
  const { reviewLoad } = useRawQueueCounts();
  const list = useUpNextRows();
  const bumps = useBumps();
  const bumpIds = useMemo(() => [...bumps.keys()], [bumps]);
  const listIds = useMemo(() => (list ?? []).map((r) => r.note_id), [list]);
  const allIds = useMemo(() => [...new Set([...listIds, ...bumpIds])], [listIds, bumpIds]);
  const data = useLiveQuery(async () => {
    const [notes, counts, decks] = await Promise.all([db.notes.bulkGet(allIds), localCardCounts(allIds), db.decks.toArray()]);
    return {
      notes: new Map(notes.filter((n): n is LocalNote => !!n).map((n) => [n.id, n])),
      counts,
      deckNames: new Map(decks.map((d) => [d.id, d.name])),
    };
  }, [allIds.join(',')]);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  const rows: UpNextViewRow[] = useMemo(() => {
    if (!list || !data) return [];
    const out: UpNextViewRow[] = [];
    for (const r of list) {
      const note = data.notes.get(r.note_id);
      const c = data.counts.get(r.note_id);
      const status = upNextStatus(queuesOf(c));
      if (status === 'done') continue; // every card studied: it leaves the list (the server drops it too)
      out.push({
        noteId: r.note_id,
        hanzi: note?.hanzi ?? '…',
        pinyin: note?.pinyin ?? '',
        english: note?.english ?? '',
        deckName: note ? data.deckNames.get(note.deck_id) ?? '' : '',
        status: upNextStatusLabel(status, c?.fresh ?? 0),
        addedBy: r.added_by_name,
        extra: (
          <button
            type="button"
            className="upnext-icon-btn upnext-bolt"
            aria-label={`Study ${note?.hanzi ?? ''} today instead`}
            title="Study it today instead (over the budget)"
            onClick={async () => {
              const out = await bumpNotes([r.note_id], 'up_next');
              await removeFromUpNext(r.note_id);
              setToast({ text: out.message });
            }}
          >
            ⚡
          </button>
        ),
      });
    }
    return out;
  }, [list, data]);

  const onReorder = useCallback((order: string[], how: 'drag' | 'top') => {
    void reorderUpNext(order, how);
  }, []);

  const onRemove = useCallback(async (noteId: string) => {
    const hanzi = data?.notes.get(noteId)?.hanzi ?? '';
    const removed = await removeFromUpNext(noteId);
    if (!removed) return;
    setToast({
      text: `Removed ${hanzi} from Up next`,
      undo: () => void addToUpNext([noteId], { position: removed.index, source: 'up_next_page' }),
    });
  }, [data]);

  const onAdd = useCallback(async (noteId: string, position: 'top' | 'bottom' | number) => {
    if (await db.notes.get(noteId)) {
      const out = await addToUpNext([noteId], { position, source: 'search' });
      setToast({ text: out.message });
      return;
    }
    // A note from the server search the device doesn't hold yet: straight to the API, then sync.
    try {
      const r = await addUpNextApi({ note_ids: [noteId], position, source: 'search' });
      setToast({ text: r.added.length ? `↑ ${r.added[0].hanzi} is up next` : 'Nothing added' });
      void syncService.incrementalSync().catch(() => undefined);
    } catch {
      setToast({ text: 'That card isn’t on this device yet — try again online.' });
    }
  }, []);

  const search = useCallback(async (q: string): Promise<UpNextSearchHit[]> => {
    const query = q.toLowerCase();
    const stripped = stripTones(query);
    const [notes, decks] = await Promise.all([db.notes.toArray(), db.decks.toArray()]);
    const names = new Map(decks.map((d) => [d.id, d.name]));
    const matches = notes.filter((n) => names.has(n.deck_id) && noteMatches(n, query, stripped)).slice(0, 25);
    const onList = new Set(listIds);
    if (matches.length > 0) {
      const counts = await localCardCounts(matches.map((n) => n.id));
      return matches.map((n) => toHit(n.id, n.hanzi, n.pinyin, n.english, names.get(n.deck_id) ?? '', onList.has(n.id), !canAddToUpNext(queuesOf(counts.get(n.id)))));
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
    const server = await searchNotesOnServer(q, 20);
    return server.notes.map((n) => toHit(n.id, n.hanzi, n.pinyin, n.english, n.deck_name, onList.has(n.id), false));
  }, [listIds]);

  const today = bumpIds.length > 0 && data ? (
    <section className="upnext-section upnext-today" aria-labelledby="upnext-today-title" data-testid="upnext-today">
      <div className="upnext-section-head">
        <h2 id="upnext-today-title" className="upnext-section-title">⚡ Today</h2>
        <span className="upnext-count">{bumpIds.length}</span>
      </div>
      <p className="upnext-hint">First in today’s study, on top of the daily budget.</p>
      <ul className="upnext-today-list">
        {bumpIds.map((id) => {
          const note = data.notes.get(id);
          const c = data.counts.get(id);
          const from = bumps.get(id)?.bumped_by_name;
          return (
            <li key={id} className="upnext-today-row">
              <span className="upnext-word">
                <span className="upnext-hanzi" lang="zh">{note?.hanzi ?? '…'}</span>
                <span className="upnext-pinyin">{note?.pinyin ?? ''}</span>
                <span className="upnext-english">{note?.english ?? ''}</span>
                <span className="upnext-meta">
                  {note ? data.deckNames.get(note.deck_id) : ''}
                  {from ? <span className="upnext-added-by"> · ⚡ from {from}</span> : null}
                </span>
              </span>
              <span className="upnext-actions">
                {canAddToUpNext(queuesOf(c)) && !listIds.includes(id) && (
                  <button
                    type="button"
                    className="upnext-chip-btn"
                    title="Not today — introduce it next instead"
                    onClick={async () => {
                      await addToUpNext([id], { position: 'top', source: 'up_next_page' });
                      await clearBump(id, 'up_next');
                      setToast({ text: `${note?.hanzi ?? ''} moved to Up next` });
                    }}
                  >
                    ↑ Up next
                  </button>
                )}
                <button type="button" className="upnext-icon-btn upnext-remove" aria-label={`Take ${note?.hanzi ?? ''} out of today`} onClick={() => void clearBump(id, 'up_next')}>
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;

  return (
    <div className="page">
      <div className="container upnext-page" data-testid="upnext-page">
        <h1>Up next</h1>
        <p className="upnext-intro">
          Words you choose to learn next. They take the first of your daily new cards, in this order — nothing extra is added.
          {' '}<Link to="/settings">New cards a day</Link>
        </p>
        {upNextPausedLabel(reviewLoad) && (
          <p className="upnext-paused" data-testid="upnext-paused">⏸ {upNextPausedLabel(reviewLoad)}</p>
        )}
        <UpNextBoard
          rows={rows}
          onReorder={onReorder}
          onRemove={(id) => void onRemove(id)}
          onAdd={(id, pos) => void onAdd(id, pos)}
          search={search}
          before={today}
          emptyText="Nothing chosen yet — search above to pick the words you want next."
        />
      </div>
      {toast && <UndoToast text={toast.text} onUndo={() => { toast.undo?.(); setToast(null); }} onDone={() => setToast(null)} hideUndo={!toast.undo} />}
    </div>
  );

  function toHit(id: string, hanzi: string, pinyin: string, english: string, deckName: string, onListNow: boolean, studied: boolean): UpNextSearchHit {
    return {
      noteId: id, hanzi, pinyin, english, deckName, onList: onListNow, studied,
      studiedAction: studied ? <BumpButton noteIds={[id]} source="up_next" compact removable label="⚡ Today" /> : undefined,
    };
  }
}
