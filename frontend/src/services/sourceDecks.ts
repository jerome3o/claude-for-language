/**
 * Source decks on the web (shared/decks/source-decks.ts, docs/STUDY_SESSION.md "Source decks"):
 * "+ Add as card" saves straight into the deck of its source ("From readers", "From chats", …) in
 * ONE request — the note-create routes take the deck ref `source:<key>` and make the deck on first
 * use — and "Change" moves the just-added note(s) to another deck (`POST /api/notes/move`).
 */
import {
  findSourceDeck, sourceDeckName, sourceDeckRef, type SourceDeckKey,
} from '@shared/decks/source-decks';
import { createNote, createNotesBatch, moveNotesApi, type BatchNoteInput, type BatchNotesResult } from '../api/client';
import { db } from '../db/database';
import { track } from './analytics';

/** Which sheet added the card (analytics `surface`: an enum token). */
export type SourceDeckSurface =
  | 'explorer'
  | 'add_chunk'
  | 'chat_flashcards'
  | 'chat_discuss'
  | 'call_flashcards'
  | 'word_recap'
  | 'coach'
  | 'other';

export interface SourceDeckNoteInput {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  context?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

/** What a source-deck add made: the note(s) and where they are now. */
export interface AddedToDeck {
  key: SourceDeckKey;
  noteIds: string[];
  deckId: string;
  deckName: string;
}

/** The deck's name on this device (renamed or not), else the source's default name. */
async function localName(key: SourceDeckKey): Promise<{ id: string; name: string } | null> {
  try {
    const decks = await db.decks.toArray();
    const d = findSourceDeck(decks, key);
    return d ? { id: d.id, name: d.name } : null;
  } catch {
    return null;
  }
}

/** Pull the new note(s) — and the source deck on first use — down now (loaded on demand: sync pulls in half the app). */
function syncSoon(): void {
  void import('./sync').then((m) => m.syncService.syncInBackground()).catch(() => undefined);
}

/** One card into the source deck (online). Throws on failure, like createNote. */
export async function addCardToSourceDeck(
  key: SourceDeckKey,
  input: SourceDeckNoteInput,
  surface: SourceDeckSurface,
): Promise<AddedToDeck & { noteId: string }> {
  const note = await createNote(sourceDeckRef(key), {
    hanzi: input.hanzi,
    pinyin: input.pinyin,
    english: input.english,
    ...(input.fun_facts ? { fun_facts: input.fun_facts } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.sentence_clue
      ? { sentence_clue: input.sentence_clue, sentence_clue_pinyin: input.sentence_clue_pinyin, sentence_clue_translation: input.sentence_clue_translation }
      : {}),
  });
  const local = note.deck ? null : await localName(key);
  const deckId = note.deck?.id ?? note.deck_id ?? local?.id ?? '';
  const deckName = note.deck?.name ?? local?.name ?? sourceDeckName(key);
  track('deck.source_add', { deck_key: key, surface, count: 1, source_deck: true });
  syncSoon();
  return { key, noteId: note.id, noteIds: [note.id], deckId, deckName };
}

/** Many cards into the source deck in one batch (online). `existing` = words already in a deck (skipExisting). */
export async function addCardsToSourceDeck(
  key: SourceDeckKey,
  notes: BatchNoteInput[],
  surface: SourceDeckSurface,
  opts: { skipExisting?: boolean } = {},
): Promise<AddedToDeck & { result: BatchNotesResult }> {
  const result = await createNotesBatch(sourceDeckRef(key), notes, opts);
  const local = result.deck ? null : await localName(key);
  const noteIds = result.created.map((c) => c.id);
  track('deck.source_add', { deck_key: key, surface, count: noteIds.length, source_deck: true, existing: result.existing?.length ?? 0 });
  if (noteIds.length) syncSoon();
  return {
    key,
    noteIds,
    deckId: result.deck?.id ?? local?.id ?? '',
    deckName: result.deck?.name ?? local?.name ?? sourceDeckName(key),
    result,
  };
}

/**
 * "Change": move the just-added note(s) to `deckId` on the server, then on this device (the note
 * and its cards carry the deck id), so the deck pages agree before the next sync.
 */
export async function moveAddedCards(added: AddedToDeck, deckId: string, deckName: string, surface: SourceDeckSurface): Promise<AddedToDeck> {
  if (added.noteIds.length === 0 || deckId === added.deckId) return { ...added, deckId, deckName };
  await moveNotesApi(added.noteIds, deckId);
  try {
    await db.transaction('rw', db.notes, db.cards, async () => {
      await db.notes.where('id').anyOf(added.noteIds).modify({ deck_id: deckId });
      await db.cards.where('note_id').anyOf(added.noteIds).modify({ deck_id: deckId });
    });
  } catch {
    // the next sync brings the move down anyway
  }
  track('deck.source_change', { deck_key: added.key, surface, count: added.noteIds.length });
  syncSoon();
  return { ...added, deckId, deckName };
}
