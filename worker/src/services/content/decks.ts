/**
 * Decks: create / rename / settings / delete / copy. Every deck a user ends up
 * with is made here, with the shared DEFAULT_DECK_SETTINGS, whichever door it
 * came through (the app, Generate with Claude, import, starter deck, a tutor's
 * copy, the MCP tools).
 */
import type { Env, Deck } from '../../types';
import * as db from '../../db/queries';
import { newDeckSettings, pickDeckSettings, type DeckSettings, type DeckSettingsProblem } from '@shared/decks';
import { deleteUnreferencedAudio } from './audio';
import type { Background } from './types';

export interface CreateDeckInput {
  name: string;
  description?: string | null;
  /** Explicit settings for this deck; anything omitted takes the shared default. */
  settings?: Partial<DeckSettings>;
}

export class ContentError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 = 400, public problems?: DeckSettingsProblem[]) {
    super(message);
  }
}

export async function createDeck(d1: D1Database, userId: string, input: CreateDeckInput): Promise<Deck> {
  const name = input.name?.trim();
  if (!name) throw new ContentError('Name is required');
  return db.createDeck(d1, userId, {
    name,
    description: input.description?.trim() || null,
    settings: newDeckSettings(input.settings),
  });
}

export async function updateDeck(
  d1: D1Database,
  userId: string,
  deckId: string,
  patch: { name?: string; description?: string | null }
): Promise<Deck | null> {
  const name = patch.name !== undefined ? patch.name.trim() : undefined;
  if (name !== undefined && !name) throw new ContentError('Name is required');
  return db.updateDeck(d1, deckId, userId, name, patch.description === null ? '' : patch.description);
}

/** The settings out of an untrusted object, or a ContentError listing what is wrong. */
export function pickDeckSettingsOrThrow(input: Record<string, unknown>): Partial<DeckSettings> {
  const { settings, problems } = pickDeckSettings(input);
  if (problems.length > 0) throw new ContentError(problems.map(p => p.message).join('; '), 400, problems);
  return settings;
}

/** Validate against the shared ranges, then store. Throws ContentError(400) with `problems` on bad input. */
export async function updateDeckSettings(
  d1: D1Database,
  userId: string,
  deckId: string,
  input: Record<string, unknown>
): Promise<Deck | null> {
  return db.updateDeckSettings(d1, deckId, userId, pickDeckSettingsOrThrow(input));
}

/**
 * Delete a deck the user owns: rows (notes and cards cascade), tombstones for
 * every device, and the clips nothing else references. Returns false when
 * the deck is not theirs.
 */
export async function deleteDeck(env: Env, userId: string, deckId: string, bg?: Background): Promise<boolean> {
  const deck = await db.getDeckById(env.DB, deckId, userId);
  if (!deck) return false;
  const keys = await collectDeckAudioKeys(env.DB, deckId);
  await db.deleteDeck(env.DB, deckId, userId);
  const cleanup = deleteUnreferencedAudio(env, keys).catch(err => console.error('[deleteDeck] audio cleanup failed', err));
  if (bg) bg.waitUntil(cleanup); else await cleanup;
  return true;
}

async function collectDeckAudioKeys(d1: D1Database, deckId: string): Promise<string[]> {
  const notes = await d1
    .prepare('SELECT audio_url, sentence_clue_audio_url FROM notes WHERE deck_id = ?')
    .bind(deckId)
    .all<{ audio_url: string | null; sentence_clue_audio_url: string | null }>();
  const sentences = await d1
    .prepare('SELECT s.audio_url FROM note_sentences s JOIN notes n ON n.id = s.note_id WHERE n.deck_id = ? AND s.audio_url IS NOT NULL')
    .bind(deckId)
    .all<{ audio_url: string }>();
  return [
    ...(notes.results || []).flatMap(n => [n.audio_url, n.sentence_clue_audio_url]),
    ...(sentences.results || []).map(s => s.audio_url),
  ].filter((k): k is string => !!k);
}

/**
 * A copy of `sourceDeck` in another user's account: a NEW deck for them, so it
 * gets the shared defaults (3 + 6 a day), not the tutor's own study settings.
 * Notes are copied with their clips (same R2 keys) and fresh cards.
 */
export async function copyDeckForUser(
  d1: D1Database,
  sourceDeck: Deck,
  targetUserId: string,
  name: string
): Promise<{ deck: Deck; noteIds: string[] }> {
  const deck = await createDeck(d1, targetUserId, { name, description: sourceDeck.description });
  const notes = await d1.prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC').bind(sourceDeck.id).all<Record<string, unknown>>();
  const noteIds: string[] = [];
  for (const note of notes.results || []) {
    noteIds.push(await db.insertNoteCopy(d1, deck.id, note));
  }
  return { deck, noteIds };
}
