import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { upNextLabel } from '@shared/decks';
import { db } from '../../db/database';
import '../upNext/upNext.css';

/**
 * Home's "↑ 4 up next: 银行、学生、老师…" (or a quiet "↑ Choose what comes next") → the Up next
 * page. The count is the list on this device (shared/decks/up-next.ts).
 */
export function UpNextHomeLine() {
  const rows = useLiveQuery(async () => {
    const list = await db.upNext.orderBy('position').toArray();
    const notes = await db.notes.bulkGet(list.slice(0, 3).map((r) => r.note_id));
    return { count: list.length, first: notes.map((n) => n?.hanzi).filter(Boolean) as string[] };
  }, []);
  if (!rows) return null;
  return (
    <Link to="/up-next" className="home-up-next" data-testid="home-up-next">
      {rows.count > 0
        ? `${upNextLabel(rows.count)}: ${rows.first.join('、')}${rows.count > rows.first.length ? '…' : ''} ›`
        : '↑ Choose what comes next ›'}
    </Link>
  );
}
