/** "Order new cards by" on the server: the account's switches against real SQLite (every migration). */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getNewCardOrderInfo, setNewCardOrder } from '../new-card-order';
import { DEFAULT_NEW_CARD_ORDER, pickNewCardOrderUpdate } from '@shared/decks';

let db: SqliteD1;

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', ['u1', 'u1@example.com', 'u1']);
  db.raw.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', ['u2', 'u2@example.com', 'u2']);
});

const stored = (id: string) => db.rows<{ new_card_order: string | null }>(`SELECT new_card_order FROM users WHERE id = '${id}'`)[0].new_card_order;

describe('new card order', () => {
  it('defaults until changed; a change is per account; back to the defaults is stored as NULL', async () => {
    expect(await getNewCardOrderInfo(db, 'u1')).toEqual({ ...DEFAULT_NEW_CARD_ORDER, is_default: true });
    const saved = await setNewCardOrder(db, 'u1', { sentences_last: false });
    expect(saved).toEqual({ ...DEFAULT_NEW_CARD_ORDER, sentences_last: false, is_default: false });
    expect(await getNewCardOrderInfo(db, 'u1')).toMatchObject({ sentences_last: false, new_words_first: true });
    expect(await getNewCardOrderInfo(db, 'u2')).toMatchObject({ is_default: true });
    await setNewCardOrder(db, 'u1', pickNewCardOrderUpdate({ reset: true }).update);
    expect(stored('u1')).toBeNull();
  });

  it('reads a stored row that is partial or garbage as the defaults per field', async () => {
    db.raw.run("UPDATE users SET new_card_order = ? WHERE id = 'u1'", ['{"most_common_first":false,"new_words_first":"x"}']);
    expect(await getNewCardOrderInfo(db, 'u1')).toEqual({ ...DEFAULT_NEW_CARD_ORDER, most_common_first: false, is_default: false });
    db.raw.run("UPDATE users SET new_card_order = ? WHERE id = 'u1'", ['nope']);
    expect(await getNewCardOrderInfo(db, 'u1')).toMatchObject({ is_default: true });
  });
});
