import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { QueueMove } from '@shared/decks';
import { moveReaderInQueue } from '@shared/reader/queue';
import { db, type LocalReader } from '../../db/database';
import { QueuePositionMenu } from '../QueuePositionMenu';
import { useLongPressReorder, type LongPressReorder } from '../../services/dragReorder';
import { readerQueueOrder, saveReaderOrder } from '../../services/readerQueue';
import { oneOffOnlyTargetIds } from '../../services/homework';
import { track } from '../../services/analytics';

/** Rows shown before "Show all": the next few are what matters day to day. */
const COLLAPSED_ROWS = 5;

/**
 * "Up next" on the Readers list: the unread stories in the order the study session
 * offers them (one a day, the top one first; shared/reader/queue.ts). #N opens Move to
 * top / up / down / bottom; press and hold a row to drag it. Works offline (IndexedDB;
 * services/readerQueue.ts keeps the order until the server has it). The queue is
 * account-wide — folders below only organise the library.
 */
/** The device's reader queue (unread, studyable, one-off homework left out), live. undefined while loading. */
export function useReaderQueue(): LocalReader[] | undefined {
  return useLiveQuery(async () => {
    const [readers, oneOff] = await Promise.all([db.readers.toArray(), oneOffOnlyTargetIds()]);
    // One-off homework readers are read in the homework pass, never offered by the session.
    return readerQueueOrder(readers, oneOff);
  }, []);
}

export function ReaderUpNext({ queue: data, onToast }: { queue: LocalReader[] | undefined; onToast?: (msg: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const queue = useMemo(() => data ?? [], [data]);
  const ids = useMemo(() => queue.map(r => r.id), [queue]);
  const visibleIds = showAll || ids.length <= COLLAPSED_ROWS + 1 ? ids : ids.slice(0, COLLAPSED_ROWS);
  const hiddenIds = ids.slice(visibleIds.length);

  const save = async (next: string[], how: string, readerId: string) => {
    try {
      const { synced } = await saveReaderOrder(next);
      track('reader.queue_move', { how, position: next.indexOf(readerId) + 1, total: next.length, via: 'app' });
      if (!synced && !navigator.onLine) onToast?.('Saved on this device — it syncs when you’re back online.');
    } catch (err) {
      console.error('[ReaderUpNext] reorder failed', err);
      onToast?.('Couldn’t move that story. Please try again.');
    }
  };

  const drag = useLongPressReorder(visibleIds, async (visibleOrder) => {
    const next = [...visibleOrder, ...hiddenIds];
    const moved = visibleOrder.find((id, i) => id !== visibleIds[i]);
    if (moved) await save(next, 'drag', moved);
  });

  if (!data || queue.length === 0) return null;
  const byId = new Map(queue.map(r => [r.id, r]));
  const rows = drag.order.map(id => byId.get(id)).filter((r): r is LocalReader => !!r);

  return (
    <section className="reader-up-next" aria-labelledby="reader-up-next-title" data-testid="reader-up-next">
      <div className="reader-up-next-head">
        <h2 id="reader-up-next-title">Up next</h2>
        <span className="reader-up-next-count">{queue.length} unread</span>
      </div>
      <p className="reader-up-next-hint">
        Your study session offers the top story — one a day. Tap <b>#N</b> to move a story, or press and hold to drag it.
      </p>
      <ol className={`reader-up-next-list${drag.dragId ? ' reader-up-next-list--dragging' : ''}`} ref={drag.listRef}>
        {rows.map(reader => (
          <UpNextRow
            key={reader.id}
            reader={reader}
            position={ids.indexOf(reader.id) + 1}
            total={ids.length}
            drag={drag}
            onMove={(to) => {
              const next = moveReaderInQueue(ids, reader.id, to);
              if (next !== ids) void save(next, to, reader.id);
            }}
          />
        ))}
      </ol>
      {hiddenIds.length > 0 && (
        <button type="button" className="reader-up-next-more" onClick={() => setShowAll(true)} data-testid="reader-up-next-show-all">
          Show all {ids.length}
        </button>
      )}
    </section>
  );
}

function UpNextRow({ reader, position, total, drag, onMove }: {
  reader: LocalReader;
  position: number;
  total: number;
  drag: LongPressReorder;
  onMove: (to: QueueMove) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dragging = drag.dragId === reader.id;
  const first = position === 1;
  return (
    <li
      className={`reader-up-next-row${first ? ' reader-up-next-row--first' : ''}${dragging ? ' reader-up-next-row--dragging' : ''}`}
      data-drag-id={reader.id}
      data-testid="reader-up-next-row"
      style={{ zIndex: menuOpen ? 20 : undefined }}
      {...drag.cardProps(reader.id)}
    >
      <Link to={`/readers/${reader.id}`} onClick={drag.onLinkClick} draggable={false} className="reader-up-next-link">
        <span className="reader-up-next-title" lang="zh-CN">{reader.title_chinese}</span>
        <span className="reader-up-next-sub">
          {first ? <span className="reader-up-next-next">Next in your session · </span> : null}
          {reader.title_english}
        </span>
      </Link>
      <QueuePositionMenu position={position} total={total} onMove={onMove} onOpenChange={setMenuOpen} label="your reader queue" />
    </li>
  );
}
