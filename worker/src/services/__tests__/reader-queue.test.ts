import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getReaderQueue, moveReaderInAccountQueue, placeNewReader, readerQueuePositions, reorderAccountReaderQueue, ReaderQueueError } from '../reader-queue';

let db: SqliteD1;
const U = 'u1';

function reader(id: string, created_at: string, opts: { user?: string; status?: string; pages?: number; read?: boolean } = {}) {
  const user = opts.user ?? U;
  db.raw.run(
    "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used, status, created_at) VALUES (?, ?, '小猫', 'Kitten', 'beginner', '[]', '[]', ?, ?)",
    [id, user, opts.status ?? 'ready', created_at],
  );
  for (let i = 0; i < (opts.pages ?? 1); i++) {
    db.raw.run("INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES (?, ?, ?, '猫。', 'māo.', 'Cat.')", [`${id}-p${i}`, id, i + 1]);
  }
  if (opts.read) db.raw.run("INSERT INTO reader_review_events (id, reader_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, '2026-10-20T10:00:00Z')", [`${id}-ev`, id, user]);
}
const order = async () => (await getReaderQueue(db, U)).queue.map(r => r.id);

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u2', 'other@example.com', 'Other', 'student')");
  reader('a', '2026-10-01 09:00:00');
  reader('b', '2026-10-02 09:00:00');
  reader('c', '2026-10-03 09:00:00');
  reader('read', '2026-10-04 09:00:00', { read: true });
  reader('gen', '2026-10-05 09:00:00', { status: 'generating', pages: 0 });
  reader('empty', '2026-10-06 09:00:00', { pages: 0 });
  reader('theirs', '2026-10-07 09:00:00', { user: 'u2' });
});

describe('reader queue (server)', () => {
  it('nobody reordered: unread ready stories newest first (unchanged)', async () => {
    expect(await order()).toEqual(['c', 'b', 'a']);
    const pos = await readerQueuePositions(db, U);
    expect([...pos.entries()]).toEqual([['c', 1], ['b', 2], ['a', 3]]);
  });

  it('a move writes the whole order; a story made later lands on top', async () => {
    const res = await moveReaderInAccountQueue(db, U, 'a', 'top');
    expect(res.queue.map(r => r.id)).toEqual(['a', 'c', 'b']);
    expect(res.queue_position).toBe(1);
    expect(await order()).toEqual(['a', 'c', 'b']);
    reader('fresh', '2026-10-10 09:00:00');
    expect(await order()).toEqual(['fresh', 'a', 'c', 'b']);
  });

  it('up / down / a 1-based place', async () => {
    await moveReaderInAccountQueue(db, U, 'a', 'up');
    expect(await order()).toEqual(['c', 'a', 'b']);
    await moveReaderInAccountQueue(db, U, 'c', 'down');
    expect(await order()).toEqual(['a', 'c', 'b']);
    const r = await moveReaderInAccountQueue(db, U, 'b', 1);
    expect(r.queue_position).toBe(1);
    expect(await order()).toEqual(['b', 'a', 'c']);
  });

  it('a no-op move on an implicit order still fixes the order (nothing visibly changes)', async () => {
    const r = await moveReaderInAccountQueue(db, U, 'c', 'top');
    expect(r.changed).toBe(false);
    expect(await order()).toEqual(['c', 'b', 'a']);
    expect(db.rows<{ queue_priority: number }>("SELECT queue_priority FROM graded_readers WHERE id = 'c'")[0].queue_priority).toBe(3);
  });

  it('refuses another account\'s reader (404) and one not in the queue (409)', async () => {
    await expect(moveReaderInAccountQueue(db, U, 'theirs', 'top')).rejects.toMatchObject({ status: 404 });
    await expect(moveReaderInAccountQueue(db, U, 'read', 'top')).rejects.toBeInstanceOf(ReaderQueueError);
    await expect(moveReaderInAccountQueue(db, U, 'gen', 'top')).rejects.toMatchObject({ status: 409 });
  });

  it('reorder: requested first, the rest after; unknown ids reported', async () => {
    const r = await reorderAccountReaderQueue(db, U, ['a', 'theirs', 'read']);
    expect(r.queue.map(x => x.id)).toEqual(['a', 'c', 'b']);
    expect(r.ignored.sort()).toEqual(['read', 'theirs']);
    expect(await order()).toEqual(['a', 'c', 'b']);
    expect(db.rows<{ queue_priority: number | null }>("SELECT queue_priority FROM graded_readers WHERE id = 'theirs'")[0].queue_priority).toBeNull();
  });

  it('a new story placed at the bottom', async () => {
    await reorderAccountReaderQueue(db, U, ['b', 'a', 'c']);
    reader('last', '2026-10-12 09:00:00');
    expect(await placeNewReader(db, U, 'last', 'bottom')).toBe(-1);
    expect(await order()).toEqual(['b', 'a', 'c', 'last']);
    reader('first', '2026-10-13 09:00:00');
    expect(await placeNewReader(db, U, 'first', 'top')).toBeNull();
    expect(await order()).toEqual(['first', 'b', 'a', 'c', 'last']);
  });

  it('bottom with nothing placed yet still goes under the unplaced stories', async () => {
    reader('last', '2026-10-12 09:00:00');
    expect(await placeNewReader(db, U, 'last', 'bottom')).toBe(-1);
    expect(await order()).toEqual(['c', 'b', 'a', 'last']);
  });
});
