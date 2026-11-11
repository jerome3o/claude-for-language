import { describe, expect, it } from 'vitest';
import {
  SOURCE_DECKS, SOURCE_DECK_KEYS, addedToDeckLine, findSourceDeck, isSourceDeckKey, legacySourceDeck, movedToDeckLine,
  parseSourceDeckRef, sourceDeckForBump, sourceDeckForExplorer, sourceDeckName, sourceDeckRef,
} from './source-decks';

describe('source decks', () => {
  it('has a small set of plain-English, unique names', () => {
    expect(SOURCE_DECK_KEYS.length).toBeLessThanOrEqual(7);
    const names = SOURCE_DECK_KEYS.map(sourceDeckName);
    expect(new Set(names).size).toBe(names.length);
    for (const k of SOURCE_DECK_KEYS) {
      expect(SOURCE_DECKS[k].key).toBe(k);
      expect(sourceDeckName(k)).toMatch(/^From /);
    }
    expect(sourceDeckName('readers')).toBe('From readers');
    expect(sourceDeckName('claude')).toBe('From Claude');
  });

  it('round-trips deck refs, encoded or not, and refuses anything else', () => {
    for (const k of SOURCE_DECK_KEYS) expect(parseSourceDeckRef(sourceDeckRef(k))).toBe(k);
    expect(parseSourceDeckRef('source%3Areaders')).toBe('readers');
    expect(parseSourceDeckRef('source:nope')).toBeNull();
    expect(parseSourceDeckRef('3f2a-deck-id')).toBeNull();
    expect(parseSourceDeckRef('')).toBeNull();
    expect(parseSourceDeckRef(null)).toBeNull();
    expect(isSourceDeckKey('claude')).toBe(true);
    expect(isSourceDeckKey('Claude')).toBe(false);
  });

  it('finds the deck by key, never by name', () => {
    const decks = [
      { id: 'a', name: 'From readers', source_key: null },
      { id: 'b', name: 'My reading words', source_key: 'readers' },
    ];
    expect(findSourceDeck(decks, 'readers')?.id).toBe('b');
    expect(findSourceDeck(decks, 'chats')).toBeNull();
  });

  it('adopts the oldest keyless legacy deck', () => {
    const decks = [
      { id: 'new', name: 'From my readers', source_key: null, created_at: '2026-10-02 10:00:00' },
      { id: 'old', name: 'From my readers', source_key: null, created_at: '2026-09-01 10:00:00' },
      { id: 'keyed', name: 'From my readers', source_key: 'chats', created_at: '2026-01-01 10:00:00' },
    ];
    expect(legacySourceDeck(decks, 'readers')?.id).toBe('old');
    expect(legacySourceDeck(decks, 'chats')).toBeNull();
  });

  it('maps the explorer and the sheets to a source', () => {
    expect(sourceDeckForExplorer('reader')).toBe('readers');
    expect(sourceDeckForExplorer('read_aloud')).toBe('readers');
    expect(sourceDeckForExplorer('chat')).toBe('chats');
    expect(sourceDeckForExplorer('coach')).toBe('claude');
    expect(sourceDeckForExplorer('breakdown')).toBe('sentences');
    expect(sourceDeckForExplorer('sentence_round')).toBe('sentences');
    expect(sourceDeckForExplorer('clips')).toBe('practice');
    expect(sourceDeckForExplorer('study')).toBe('explorer');
    expect(sourceDeckForExplorer(undefined)).toBe('explorer');
    expect(sourceDeckForExplorer('toString')).toBe('explorer');
    expect(sourceDeckForBump('picture_hunt')).toBe('practice');
    expect(sourceDeckForBump('chat_discuss')).toBe('chats');
    expect(sourceDeckForBump('other')).toBe('explorer');
    expect(sourceDeckForBump('constructor')).toBe('explorer');
  });

  it('says where the card went', () => {
    expect(addedToDeckLine('From readers')).toBe('Added to From readers');
    expect(addedToDeckLine('From chats', 3)).toBe('3 cards added to From chats');
    expect(movedToDeckLine('HSK 2')).toBe('Moved to HSK 2');
    expect(addedToDeckLine('  ')).toBe('Added to your deck');
  });
});
