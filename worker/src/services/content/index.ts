/**
 * The content service: the single semantic layer for decks, notes and cards.
 *
 *   route / tool / job  →  services/content  →  db/queries  →  D1
 *
 * Nothing outside this folder should INSERT / UPDATE / DELETE decks, notes or
 * cards, and nothing outside it should decide a new deck's settings. The MCP
 * server reaches it through the HTTP API.
 */
export * from './types';
export * from './decks';
export * from './notes';
export * from './audio';
