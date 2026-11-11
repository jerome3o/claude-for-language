/**
 * Source decks (shared/decks/source-decks.ts): the content service's get-or-create by stable key,
 * against real SQLite with every migration (UNIQUE (user_id, source_key) included).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { ensureSourceDeck, flashcardDeckFor, resolveNoteDeck, createDeck, updateDeck, ContentError } from '../content';
import { DEFAULT_DECK_SETTINGS } from '@shared/decks';

let db: SqliteD1;

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u2', 'other@example.com', 'Other', 'student')");
});

const decksOf = (userId: string) => db.rows<{ id: string; name: string; source_key: string | null; study_priority: number; new_cards_per_day: number }>(
  'SELECT id, name, source_key, study_priority, new_cards_per_day FROM decks WHERE user_id = ? ORDER BY created_at, id',
  [userId],
);

describe('ensureSourceDeck', () => {
  it('makes the deck once, with the shared defaults, at the top of the queue', async () => {
    await createDeck(db, 'u1', { name: 'HSK 2' });
    const first = await ensureSourceDeck(db, 'u1', 'readers');
    expect(first.created).toBe(true);
    expect(first.deck.name).toBe('From readers');
    expect(first.deck.source_key).toBe('readers');
    expect(first.deck.new_cards_per_day).toBe(DEFAULT_DECK_SETTINGS.new_cards_per_day);
    const top = Math.max(...decksOf('u1').map((d) => d.study_priority));
    expect(first.deck.study_priority).toBe(top);

    const again = await ensureSourceDeck(db, 'u1', 'readers');
    expect(again.created).toBe(false);
    expect(again.deck.id).toBe(first.deck.id);
    expect(decksOf('u1').filter((d) => d.source_key === 'readers')).toHaveLength(1);
  });

  it('concurrent calls make ONE deck', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureSourceDeck(db, 'u1', 'chats')));
    const ids = new Set(results.map((r) => r.deck.id));
    expect(ids.size).toBe(1);
    expect(decksOf('u1').filter((d) => d.source_key === 'chats')).toHaveLength(1);
  });

  it('finds the deck again after a rename (by key, never by name)', async () => {
    const { deck } = await ensureSourceDeck(db, 'u1', 'claude');
    await updateDeck(db, 'u1', deck.id, { name: 'Claude words' });
    // A deck with the default name is NOT the source deck.
    await createDeck(db, 'u1', { name: 'From Claude' });
    const again = await ensureSourceDeck(db, 'u1', 'claude');
    expect(again.deck.id).toBe(deck.id);
    expect(again.deck.name).toBe('Claude words');
  });

  it('is per user and per key', async () => {
    const a = await ensureSourceDeck(db, 'u1', 'explorer');
    const b = await ensureSourceDeck(db, 'u2', 'explorer');
    const c = await ensureSourceDeck(db, 'u1', 'practice');
    expect(new Set([a.deck.id, b.deck.id, c.deck.id]).size).toBe(3);
    expect(b.deck.user_id).toBe('u2');
  });

  it('adopts the legacy "From my readers" deck instead of making a second one', async () => {
    const legacy = await createDeck(db, 'u1', { name: 'From my readers' });
    const { deck, created } = await ensureSourceDeck(db, 'u1', 'readers');
    expect(created).toBe(false);
    expect(deck.id).toBe(legacy.id);
    expect(deck.name).toBe('From my readers');
    expect(deck.source_key).toBe('readers');
    // Not adopted by another source.
    expect((await ensureSourceDeck(db, 'u1', 'chats')).deck.id).not.toBe(legacy.id);
  });

  it('the database refuses a second deck with the same key', async () => {
    await ensureSourceDeck(db, 'u1', 'sentences');
    await expect(createDeck(db, 'u1', { name: 'Another', sourceKey: 'sentences' })).rejects.toThrow(/UNIQUE/);
  });
});

describe('resolveNoteDeck / flashcardDeckFor', () => {
  it('a deck id passes through; a source ref is made on first use', async () => {
    expect(await resolveNoteDeck(db, 'u1', 'some-deck-id')).toEqual({ deckId: 'some-deck-id', sourceDeck: null });
    const r = await resolveNoteDeck(db, 'u1', 'source:readers');
    expect(r.sourceDeck?.source_key).toBe('readers');
    expect(r.deckId).toBe(r.sourceDeck?.id);
    expect((await resolveNoteDeck(db, 'u1', 'source%3Areaders')).deckId).toBe(r.deckId);
    await expect(resolveNoteDeck(db, 'u1', 'source:nope')).rejects.toBeInstanceOf(ContentError);
  });

  it('create_flashcards: the named deck when it is his, else "From Claude"', async () => {
    const mine = await createDeck(db, 'u1', { name: 'HSK 3' });
    const theirs = await createDeck(db, 'u2', { name: 'Not mine' });
    expect((await flashcardDeckFor(db, 'u1', mine.id, 'claude')).id).toBe(mine.id);
    const fallback = await flashcardDeckFor(db, 'u1', undefined, 'claude');
    expect(fallback.source_key).toBe('claude');
    expect(fallback.name).toBe('From Claude');
    expect((await flashcardDeckFor(db, 'u1', theirs.id, 'claude')).id).toBe(fallback.id);
    expect((await flashcardDeckFor(db, 'u1', 'made-up', 'claude')).id).toBe(fallback.id);
  });
});
