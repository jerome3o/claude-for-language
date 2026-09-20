/**
 * Decks for students: build a deck in the tutor's account through the API
 * (so every note gets TTS the normal way) and share it, or top up an
 * already-shared deck so the student's copy receives the new words.
 */
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import type { ApiClient } from '../../api.js';
import { jsonResult, errorResult, guard } from '../context.js';
import { normalizeNotes, notesMissingAudio, type NoteInput } from './specs.js';

const RELATIONSHIP_ID = z.string().describe('The tutor–student relationship id (from list_students or the students tools)');

const noteShape = z.object({
  hanzi: z.string().describe('Chinese characters (simplified)'),
  pinyin: z.string().describe('Pinyin with tone marks (nǐ hǎo) — tone numbers are rejected'),
  english: z.string().describe('English meaning'),
  fun_facts: z.string().optional().describe('Substantive learning note: grammar pattern, usage, common mistake, or how it differs from a similar word'),
  sentence_clue: z.string().optional().describe('One short example sentence in Chinese using the word (gets its own TTS)'),
});

export interface AudioWaitOptions {
  /** How many times to re-read the deck while waiting for background TTS. */
  attempts: number;
  delayMs: number;
}

const DEFAULT_AUDIO_WAIT: AudioWaitOptions = { attempts: 6, delayMs: 1500 };

interface ApiDeck { id: string; name: string; description?: string | null }
interface ApiNote { id: string; hanzi: string; audio_url: string | null }
interface DeckWithNotes extends ApiDeck { notes: ApiNote[] }

interface CreateNotesOutcome {
  created: Array<{ id: string; hanzi: string }>;
  failed: Array<{ hanzi: string; error: string }>;
}

/** POST each note to the deck; a failure is recorded and the rest continue. */
async function createNotes(api: ApiClient, deckId: string, notes: NoteInput[]): Promise<CreateNotesOutcome> {
  const outcome: CreateNotesOutcome = { created: [], failed: [] };
  for (const note of notes) {
    try {
      const made = await api.post<ApiNote>(`/api/decks/${encodeURIComponent(deckId)}/notes`, {
        hanzi: note.hanzi,
        pinyin: note.pinyin,
        english: note.english,
        fun_facts: note.fun_facts,
      });
      if (note.sentence_clue) {
        // The create route has no sentence field; the update route saves it
        // and generates the sentence's own audio.
        try {
          await api.put(`/api/notes/${encodeURIComponent(made.id)}`, { sentence_clue: note.sentence_clue });
        } catch (err) {
          console.error('[content] sentence_clue not saved for', note.hanzi, err);
        }
      }
      outcome.created.push({ id: made.id, hanzi: note.hanzi });
    } catch (err) {
      outcome.failed.push({ hanzi: note.hanzi, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcome;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * The note route starts TTS in the background; sharing copies audio_url as
 * it is at that moment. Wait a little for the clips, then generate the
 * stragglers synchronously so the student's copy is not silent. Returns the
 * ids still without audio (the shared-deck update can fill them in later).
 */
async function waitForNoteAudio(api: ApiClient, deckId: string, noteIds: string[], wait: AudioWaitOptions): Promise<string[]> {
  if (noteIds.length === 0) return [];
  let missing = noteIds;
  for (let attempt = 0; attempt < wait.attempts && missing.length > 0; attempt++) {
    await sleep(wait.delayMs);
    try {
      const deck = await api.get<DeckWithNotes>(`/api/decks/${encodeURIComponent(deckId)}`);
      missing = notesMissingAudio(deck.notes ?? [], noteIds);
    } catch (err) {
      console.error('[content] deck re-read failed while waiting for audio:', err);
    }
  }
  const still: string[] = [];
  for (const id of missing) {
    try {
      const note = await api.post<ApiNote>(`/api/notes/${encodeURIComponent(id)}/generate-audio`);
      if (!note?.audio_url) still.push(id);
    } catch {
      still.push(id);
    }
  }
  return still;
}

export function registerStudentDeckTools(ctx: ToolContext, options: { audioWait?: AudioWaitOptions } = {}): void {
  const { server, api } = ctx;
  const wait = options.audioWait ?? DEFAULT_AUDIO_WAIT;

  server.tool(
    'create_deck_for_student',
    `Build a vocabulary deck for a student and send it as homework in one go: creates the deck and its notes in YOUR (the tutor's) account — every note gets TTS audio and three cards — then shares a copy with the student (it lands in their app as "<name> (from tutor)" on their next sync and counts towards their Homework %). You must be the tutor in the relationship. Keep the words the student does not already have (batch_search_notes checks your own decks, list_student_lessons / the students tools show what they received). Notes with a missing field, tone-number pinyin or a duplicate hanzi in the batch are rejected up front and listed; a note the API refuses is skipped and listed under failed while the rest continue. Later additions go through add_words_to_student_deck (the returned shared_deck_id is what it needs).`,
    {
      relationship_id: RELATIONSHIP_ID,
      name: z.string().min(1).describe('Deck name as the student will see it (the app appends "(from tutor)")'),
      description: z.string().optional().describe('One line on what the deck covers'),
      notes: z.array(noteShape).min(1).describe('The words to put in the deck'),
    },
    async ({ relationship_id, name, description, notes }) => guard(async () => {
      const { notes: clean, rejected } = normalizeNotes(notes);
      if (clean.length === 0) {
        return errorResult(`No usable notes:\n- ${rejected.map(r => `${r.hanzi}: ${r.reason}`).join('\n- ')}`);
      }
      const deck = await api.post<ApiDeck>('/api/decks', { name: name.trim(), description: description?.trim() || undefined });
      const outcome = await createNotes(api, deck.id, clean);
      if (outcome.created.length === 0) {
        return errorResult(`Deck "${deck.name}" (id=${deck.id}) was created but no note could be added:\n- ${outcome.failed.map(f => `${f.hanzi}: ${f.error}`).join('\n- ')}`);
      }
      const audioMissing = await waitForNoteAudio(api, deck.id, outcome.created.map(n => n.id), wait);
      const shared = await api.post<{ id: string; target_deck_id: string; target_deck_name: string }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/share-deck`,
        { deck_id: deck.id },
      );
      return jsonResult({
        tutor_deck_id: deck.id,
        student_deck_id: shared.target_deck_id,
        student_deck_name: shared.target_deck_name,
        shared_deck_id: shared.id,
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_missing: audioMissing.length,
        message: `Deck "${deck.name}" with ${outcome.created.length} word(s) is on its way to the student as "${shared.target_deck_name}".${audioMissing.length ? ` ${audioMissing.length} word(s) still have no audio — add_words_to_student_deck (even with an empty list) copies clips across once they exist.` : ''}`,
      });
    }),
  );

  server.tool(
    'add_words_to_student_deck',
    `Add words to a deck you already shared with a student: the notes go into YOUR source deck (with TTS), then the student's copy is brought up to date — new words are added to it, words it already has (matched by hanzi) keep their progress, and copies missing audio get your clip. Pass the shared_deck_id from create_deck_for_student or the students tools' homework list (not a plain deck id). An empty notes list just re-syncs the copy (useful to fill in audio that was still generating).`,
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().describe('The share record id (shared_deck_id), from create_deck_for_student or the homework deck list'),
      notes: z.array(noteShape).describe('The words to add (may be empty to just re-sync the student\'s copy)'),
    },
    async ({ relationship_id, shared_deck_id, notes }) => guard(async () => {
      const shares = await api.get<Array<{ id: string; source_deck_id: string; target_deck_id: string; source_deck_name: string }>>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks`,
      );
      const share = shares.find(s => s.id === shared_deck_id);
      if (!share) {
        const known = shares.map(s => `${s.id} (${s.source_deck_name})`).join(', ') || 'none';
        return errorResult(`No shared deck ${shared_deck_id} in this relationship. Shared decks: ${known}.`);
      }
      const { notes: clean, rejected } = normalizeNotes(notes);
      const outcome = clean.length > 0 ? await createNotes(api, share.source_deck_id, clean) : { created: [], failed: [] };
      const audioMissing = await waitForNoteAudio(api, share.source_deck_id, outcome.created.map(n => n.id), wait);
      const update = await api.post<{ added: number; kept: number; audio_filled: number; updated?: number }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`,
      );
      return jsonResult({
        tutor_deck_id: share.source_deck_id,
        student_deck_id: share.target_deck_id,
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_missing: audioMissing.length,
        student_copy: update,
        message: `${outcome.created.length} word(s) added to "${share.source_deck_name}"; the student's copy gained ${update.added} new word(s), took the tutor's newer text on ${update.updated ?? 0}, kept ${update.kept}, and ${update.audio_filled} clip(s) were filled in.`,
      });
    }),
  );

  server.tool(
    'get_starter_deck',
    'Get (creating it if needed) your built-in "Starter Chinese" deck — 15 first words with tone-marked pinyin, an example sentence each and TTS. Idempotent: returns the existing deck by name. Its id is what you pass to share-deck flows or invites for a brand-new student.',
    {},
    async () => guard(async () => {
      const res = await api.post<{ deck: ApiDeck; created: boolean; word_count: number }>('/api/decks/starter');
      return jsonResult({
        deck_id: res.deck.id,
        name: res.deck.name,
        created: res.created,
        word_count: res.word_count,
        message: res.created ? `Created "${res.deck.name}" (id=${res.deck.id}); audio is generating in the background.` : `"${res.deck.name}" already exists (id=${res.deck.id}).`,
      });
    }),
  );
}
