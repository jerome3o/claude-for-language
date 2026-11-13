/**
 * Golden vectors for source decks (shared/decks/source-decks.ts): the keys and names, deck refs,
 * the explorer / bump source → deck mappings and the "Added to …" lines. Writes source-decks.json;
 * checked by core/…/SourceDecksParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SOURCE_DECKS, SOURCE_DECK_KEYS, addedToDeckLine, movedToDeckLine, parseSourceDeckRef, sourceDeckForBump,
  sourceDeckForExplorer, sourceDeckRef,
} from '../../../shared/decks/source-decks';
import { BUMP_SOURCES } from '../../../shared/decks/bumps';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const EXPLORER_SOURCES = [
  'study', 'homework', 'reader', 'chat', 'ask_claude', 'claude_chat', 'claude_card', 'breakdown', 'coach', 'lesson', 'card_hub', 'idioms',
  'audio_lesson', 'meme_review', 'word_tag', 'clips', 'phone', 'read_aloud', 'sentence_round', 'podcast', 'call', 'picture_hunt', 'other',
  '', 'toString', 'READER',
];

const refs = [
  ...SOURCE_DECK_KEYS.map(sourceDeckRef),
  'source%3Areaders', 'SOURCE%3aclaude', 'source%3Anope', 'source:', 'source:Readers', 'source:nope', ' source:chats ',
  'deck-123', '', 'readers',
];

const names: Array<[string, number]> = [['From readers', 1], ['From chats', 3], ['HSK 2', 2], ['  ', 1], [' From Claude ', 1]];

writeFileSync(
  join(OUT, 'source-decks.json'),
  JSON.stringify({
    decks: SOURCE_DECK_KEYS.map((k) => ({ key: k, name: SOURCE_DECKS[k].name, description: SOURCE_DECKS[k].description, legacy: SOURCE_DECKS[k].legacyNames })),
    refs: refs.map((r) => ({ ref: r, key: parseSourceDeckRef(r) })),
    explorer: EXPLORER_SOURCES.map((s) => ({ source: s, key: sourceDeckForExplorer(s) })),
    bump: [...BUMP_SOURCES, '', 'constructor'].map((s) => ({ source: s, key: sourceDeckForBump(s) })),
    lines: names.map(([n, c]) => ({ name: n, count: c, added: addedToDeckLine(n, c), moved: movedToDeckLine(n, c) })),
  }),
);
