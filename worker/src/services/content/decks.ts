/**
 * Decks: create / rename / settings / delete / copy. Every deck a user ends up
 * with is made here, with the shared DEFAULT_DECK_SETTINGS, whichever door it
 * came through (the app, Generate with Claude, import, starter deck, a tutor's
 * copy, the MCP tools).
 */
import type { Env, Deck } from '../../types';
import * as db from '../../db/queries';
import { trackServer } from '../analytics/server-events';
import { newDeckSettings, pickDeckSettings, type DeckSettings, type DeckSettingsProblem, type QueueMove } from '@shared/decks';
import { SOURCE_DECKS, legacySourceDeck, parseSourceDeckRef, type SourceDeckKey } from '@shared/decks/source-decks';
export { parseSourceDeckRef, isSourceDeckKey } from '@shared/decks/source-decks';
import { deleteUnreferencedAudio } from './audio';
import { deleteUnreferencedNoteImages, noteImageKeysOfDeck } from '../note-images';
import type { Background } from './types';

export interface CreateDeckInput {
  name: string;
  description?: string | null;
  /** Explicit settings for this deck; anything omitted takes the shared default. */
  settings?: Partial<DeckSettings>;
  /** Where the deck joins the learner's new-card queue. Default: top (new things first). */
  placement?: 'top' | 'bottom';
  /** A source deck's key (ensureSourceDeck only). */
  sourceKey?: SourceDeckKey;
}

export class ContentError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 = 400, public problems?: DeckSettingsProblem[]) {
    super(message);
  }
}

export async function createDeck(d1: D1Database, userId: string, input: CreateDeckInput): Promise<Deck> {
  const name = input.name?.trim();
  if (!name) throw new ContentError('Name is required');
  const range = await db.getDeckPriorityRange(d1, userId);
  void trackServer('server.content_created', { kind: 'deck', count: 1 }, { userId });
  return db.createDeck(d1, userId, {
    name,
    description: input.description?.trim() || null,
    settings: newDeckSettings(input.settings),
    study_priority: input.placement === 'bottom' ? range.min - 1 : range.max + 1,
    source_key: input.sourceKey ?? null,
  });
}

// ============ Source decks ("From readers", "From chats", …) ============

/**
 * The learner's deck for a source (shared/decks/source-decks.ts): found by its stable
 * `source_key` (never by name — he may rename it); else a keyless deck with the source's legacy
 * name is adopted ("From my readers", the reader word recap's deck by name); else a new one is made
 * with the shared defaults, at the TOP of the queue like any deck he creates himself.
 * Idempotent under races: UNIQUE (user_id, source_key) lets one insert / adoption win, the loser
 * reads the winner's deck.
 */
export async function ensureSourceDeck(d1: D1Database, userId: string, key: SourceDeckKey): Promise<{ deck: Deck; created: boolean }> {
  const found = await db.getSourceDeck(d1, userId, key);
  if (found) return { deck: found, created: false };

  const def = SOURCE_DECKS[key];
  if (def.legacyNames.length > 0) {
    const candidates = await d1
      .prepare(`SELECT * FROM decks WHERE user_id = ? AND source_key IS NULL AND name IN (${def.legacyNames.map(() => '?').join(', ')})`)
      .bind(userId, ...def.legacyNames)
      .all<Deck>();
    const legacy = legacySourceDeck(candidates.results ?? [], key);
    if (legacy) {
      try {
        await d1
          .prepare("UPDATE decks SET source_key = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND source_key IS NULL")
          .bind(key, legacy.id, userId)
          .run();
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      const adopted = await db.getSourceDeck(d1, userId, key);
      if (adopted) return { deck: adopted, created: false };
    }
  }

  try {
    const deck = await createDeck(d1, userId, { name: def.name, description: def.description, sourceKey: key });
    return { deck, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await db.getSourceDeck(d1, userId, key);
    if (!winner) throw err;
    return { deck: winner, created: false };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * The deck a note-create request names: a deck id, or a source deck ref (`source:readers`) which is
 * made on first use. `sourceDeck` is set for a ref, so the reply can say where the card went.
 */
export async function resolveNoteDeck(d1: D1Database, userId: string, deckParam: string): Promise<{ deckId: string; sourceDeck: Deck | null }> {
  const key = parseSourceDeckRef(deckParam);
  if (!key) {
    if (deckParam.startsWith('source:') || /^source%3a/i.test(deckParam)) throw new ContentError('Unknown source deck', 400);
    return { deckId: deckParam, sourceDeck: null };
  }
  const { deck } = await ensureSourceDeck(d1, userId, key);
  return { deckId: deck.id, sourceDeck: deck };
}

/**
 * Where an agent's create_flashcards goes: the deck it named when that is the learner's own, else
 * the source deck for `fallback` ("From Claude") — an unknown id never fails the cards.
 */
export async function flashcardDeckFor(d1: D1Database, userId: string, deckId: string | null | undefined, fallback: SourceDeckKey): Promise<Deck> {
  if (typeof deckId === 'string' && deckId.trim()) {
    const ref = parseSourceDeckRef(deckId);
    if (ref) return (await ensureSourceDeck(d1, userId, ref)).deck;
    const named = await db.getDeckById(d1, deckId.trim(), userId);
    if (named) return named;
  }
  return (await ensureSourceDeck(d1, userId, fallback)).deck;
}

/** What a reply says about a source deck: enough for "Added to From readers · Change". */
export function sourceDeckSummary(deck: Deck): { id: string; name: string; source_key: string | null } {
  return { id: deck.id, name: deck.name, source_key: deck.source_key ?? null };
}

/** Move a deck to the top or bottom of the user's queue. */
export async function moveDeck(d1: D1Database, userId: string, deckId: string, to: 'top' | 'bottom'): Promise<boolean> {
  return db.moveDeck(d1, userId, deckId, to);
}

/** Set the queue order outright (first = highest priority). */
/** Move one deck a step or to an end of the queue; null when it is not the user's. */
export async function moveDeckInQueue(d1: D1Database, userId: string, deckId: string, to: QueueMove) {
  return db.moveDeckInQueue(d1, userId, deckId, to);
}

export async function reorderDecks(d1: D1Database, userId: string, orderedIds: string[]): Promise<number> {
  const ids = orderedIds.filter((id, i) => typeof id === 'string' && id && orderedIds.indexOf(id) === i);
  if (ids.length > 500) throw new ContentError('Too many decks in one reorder');
  return db.reorderDecks(d1, userId, ids);
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
  const imageKeys = await noteImageKeysOfDeck(env.DB, deckId);
  await db.deleteDeck(env.DB, deckId, userId);
  const cleanup = Promise.all([
    deleteUnreferencedAudio(env, keys),
    deleteUnreferencedNoteImages(env, imageKeys),
  ]).catch(err => console.error('[deleteDeck] audio cleanup failed', err));
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
  name: string,
  placement: 'top' | 'bottom' = 'top',
  /** Source notes to leave out (e.g. words the student already has). */
  options: { excludeNoteIds?: ReadonlySet<string> } = {}
): Promise<{ deck: Deck; noteIds: string[] }> {
  const deck = await createDeck(d1, targetUserId, { name, description: sourceDeck.description, placement });
  const notes = await d1.prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at ASC').bind(sourceDeck.id).all<Record<string, unknown>>();
  const noteIds: string[] = [];
  for (const note of notes.results || []) {
    if (options.excludeNoteIds?.has(String(note.id))) continue;
    noteIds.push(await db.insertNoteCopy(d1, deck.id, note));
  }
  return { deck, noteIds };
}
