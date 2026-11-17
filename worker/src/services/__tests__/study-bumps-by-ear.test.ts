/**
 * "⚡ Study it today" on a word just added (shared/decks/study-today.ts), against real SQLite with every
 * migration: a bump that arrives without a plan (an app build that sends a whole-note row for a note it
 * hasn't synced yet, Claude's / the MCP's bump_cards) is planned by the server. Regression (Nov 2026): a
 * word added from an example sentence's "What's going on here?" breakdown has no clip for a few seconds
 * (made in the background after the add), and the server bumped its READING card instead of the listening
 * card "Start new words by ear" leads with everywhere else.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { ensureSourceDeck } from '../content';
import { createNote } from '../../db/queries';
import { addBumps } from '../study-bumps';

let db: SqliteD1;

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
});

async function justAdded(hanzi: string, audioUrl: string | null = null): Promise<string> {
  const { deck } = await ensureSourceDeck(db, 'u1', 'sentences');
  const note = await createNote(db, deck.id, { hanzi, pinyin: 'yòucè', english: 'right side', audio_url: audioUrl });
  return note.id;
}

const cardTypesOf = (noteId: string) =>
  db.rows<{ card_types: string | null }>('SELECT card_types FROM study_bumps WHERE user_id = ? AND note_id = ?', ['u1', noteId])[0]?.card_types ?? null;

describe('server-planned ⚡ of a word whose clip is still being made', () => {
  it('"Start new words by ear" on (the default): only its listening card', async () => {
    const id = await justAdded('右侧');
    const r = await addBumps(db, 'u1', { noteIds: [id], source: 'explorer' });
    expect(r.kinds?.[id]).toBe('listening');
    expect(JSON.parse(cardTypesOf(id)!)).toEqual(['audio_to_hanzi']);
  });

  it('"Start new words by ear" off: the lead card, as before', async () => {
    db.raw.run(`UPDATE users SET new_card_order = '{"new_words_by_ear":false}' WHERE id = 'u1'`);
    const id = await justAdded('右侧');
    await addBumps(db, 'u1', { noteIds: [id], source: 'explorer' });
    expect(JSON.parse(cardTypesOf(id)!)).toEqual(['hanzi_to_meaning']);
  });

  it('a word with its clip: the listening card whatever the switch', async () => {
    db.raw.run(`UPDATE users SET new_card_order = '{"new_words_by_ear":false}' WHERE id = 'u1'`);
    const id = await justAdded('右侧', '/api/audio/generated/x.mp3');
    await addBumps(db, 'u1', { noteIds: [id], source: 'explorer' });
    expect(JSON.parse(cardTypesOf(id)!)).toEqual(['audio_to_hanzi']);
  });
});
