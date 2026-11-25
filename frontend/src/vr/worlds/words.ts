/**
 * An object's word and the learner's cards (docs/VR_WORLDS.md "Inspect → word"): is it new, in his
 * decks, or known (a mature card)? "+ Add as card" saves it straight into the "From VR" source deck
 * (shared/decks/source-decks.ts `vr`, one request); a word he already has gets "⚡ Study it today"
 * instead (the ONE ⚡ rule, services/studyBumps.ts). Device data first — works offline except the add.
 */
import { isKnownCardState } from '@shared/decks/lead-card';
import { normalizeHanzi } from '@shared/import/parse';
import type { WorldWord } from '@shared/vr-worlds';
import { db } from '../../db/database';
import { addCardToSourceDeck } from '../../services/sourceDecks';
import { bumpNotes, findExistingNotes } from '../../services/studyBumps';
import type { WordStatus } from './panels';

export interface WordInfo {
  status: WordStatus;
  noteId: string | null;
  deckName: string | null;
  bumped: boolean;
}

/** What the learner has for this word on this device. */
export async function lookupWorldWord(hanzi: string): Promise<WordInfo> {
  const found = await findExistingNotes(hanzi).catch(() => []);
  if (found.length === 0) return { status: 'new', noteId: null, deckName: null, bumped: false };
  const ids = found.map((f) => f.note.id);
  const cards = await db.cards.where('note_id').anyOf(ids).toArray().catch(() => []);
  const knownNote = cards.find((c) => isKnownCardState(c.queue, c.stability))?.note_id ?? null;
  const pick = found.find((f) => f.note.id === knownNote) ?? found[0];
  const bump = await db.studyBumps.where('note_id').equals(pick.note.id).first().catch(() => undefined);
  return {
    status: knownNote ? 'known' : 'in_decks',
    noteId: pick.note.id,
    deckName: pick.deckName,
    bumped: !!bump && bump.pending !== 'clear',
  };
}

/** Which of these words he KNOWS (a mature card) — the ✓ on hover labels. Keys: normalised hanzi. */
export async function knownWords(hanzi: readonly string[]): Promise<Set<string>> {
  const want = new Set(hanzi.map(normalizeHanzi).filter(Boolean));
  const out = new Set<string>();
  if (want.size === 0) return out;
  try {
    const notes = await db.notes.filter((n) => want.has(normalizeHanzi(n.hanzi ?? ''))).toArray();
    if (notes.length === 0) return out;
    const cards = await db.cards.where('note_id').anyOf(notes.map((n) => n.id)).toArray();
    const known = new Set(cards.filter((c) => isKnownCardState(c.queue, c.stability)).map((c) => c.note_id));
    for (const n of notes) if (known.has(n.id)) out.add(normalizeHanzi(n.hanzi));
  } catch {
    /* no device data yet */
  }
  return out;
}

/** "+ Add as card": the object's word (with its explanation and example when the world gives them) into "From VR". */
export async function addWorldWordCard(word: WorldWord): Promise<{ noteId: string; deckName: string }> {
  const added = await addCardToSourceDeck('vr', {
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    english: word.english,
    ...(word.fun_facts ? { fun_facts: word.fun_facts } : {}),
    ...(word.example ? { sentence_clue: word.example.hanzi, sentence_clue_pinyin: word.example.pinyin, sentence_clue_translation: word.example.english } : {}),
  }, 'vr_world');
  return { noteId: added.noteId, deckName: added.deckName };
}

/** "⚡ Study it today" on a word he has (or just added from here). */
export async function bumpWorldWord(noteId: string, hanzi: string, justCreated: boolean): Promise<string> {
  const out = await bumpNotes([noteId], 'other', new Map([[noteId, hanzi]]), justCreated ? { justCreated: new Set([noteId]) } : {});
  return out.message;
}
