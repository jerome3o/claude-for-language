/**
 * `GET /api/sync/changes` hands the client a millisecond cursor while rows carry whole
 * seconds: a tombstone written in the same second as the previous sync must still come
 * down (the Lab app's SyncContractTest caught a deleted note that never left the phone).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getDeletedItemsSince } from '../../db/queries';

describe('getDeletedItemsSince', () => {
  let db: SqliteD1;

  beforeEach(async () => {
    db = await createSqliteD1();
    const insert = db.raw.prepare('INSERT INTO deleted_items (id, user_id, kind, item_id, deleted_at) VALUES (?, ?, ?, ?, ?)');
    insert.run(['t1', 'u1', 'note', 'n-before', '2026-09-27 16:35:43']);
    insert.run(['t2', 'u1', 'note', 'n-same-second', '2026-09-27 16:35:44']);
    insert.run(['t3', 'u1', 'deck', 'd-after', '2026-09-27 16:35:45']);
    insert.run(['t4', 'u2', 'note', 'n-other-user', '2026-09-27 16:35:44']);
    insert.free();
  });

  it('includes tombstones from the cursor’s own second', async () => {
    // A cursor of 16:35:44.300 is sent as "2026-09-27 16:35:44".
    const got = await getDeletedItemsSince(db, 'u1', '2026-09-27 16:35:44');
    expect(got.note_ids).toEqual(['n-same-second']);
    expect(got.deck_ids).toEqual(['d-after']);
  });
});
