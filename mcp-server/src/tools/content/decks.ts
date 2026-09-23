/**
 * Decks for students: build a deck in the tutor's account through the API
 * (so every note gets TTS the normal way) and share it, or top up an
 * already-shared deck so the student's copy receives the new words.
 *
 * These tools never wait for TTS. The note route starts it in the background
 * and the worker copies each clip onto the student's copy as soon as it
 * exists (propagateNoteAudioToSharedCopies), so a tool call returns in a few
 * seconds instead of hanging the chat while a minute of audio renders.
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
  /** How many times to re-read the deck to count clips still generating (for the report only). */
  attempts: number;
  delayMs: number;
}

/** One quick look, so the reply can say how many clips are still rendering. */
const DEFAULT_AUDIO_WAIT: AudioWaitOptions = { attempts: 1, delayMs: 800 };

/** Notes posted at once; TTS for each runs server-side in the background. */
const CREATE_CONCURRENCY = 5;

interface ApiDeck { id: string; name: string; description?: string | null }
interface ApiNote { id: string; hanzi: string; audio_url: string | null }
interface DeckWithNotes extends ApiDeck { notes: ApiNote[] }

interface CreateNotesOutcome {
  created: Array<{ id: string; hanzi: string }>;
  failed: Array<{ hanzi: string; error: string }>;
}

/**
 * POST the notes to the deck a few at a time; a failure is recorded and the
 * rest continue. Results keep the input order.
 */
async function createNotes(api: ApiClient, deckId: string, notes: NoteInput[]): Promise<CreateNotesOutcome> {
  const outcome: CreateNotesOutcome = { created: [], failed: [] };
  const createOne = async (note: NoteInput): Promise<{ id: string; hanzi: string } | { hanzi: string; error: string }> => {
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
      return { id: made.id, hanzi: note.hanzi };
    } catch (err) {
      return { hanzi: note.hanzi, error: err instanceof Error ? err.message : String(err) };
    }
  };
  for (let i = 0; i < notes.length; i += CREATE_CONCURRENCY) {
    const results = await Promise.all(notes.slice(i, i + CREATE_CONCURRENCY).map(createOne));
    for (const r of results) {
      if ('id' in r) outcome.created.push(r);
      else outcome.failed.push(r);
    }
  }
  return outcome;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * How many of the new notes have no clip yet. Purely informational: sharing
 * does not wait for audio, because the worker copies each clip onto the
 * student's copy when TTS finishes. Never generates audio synchronously — a
 * minute of TTS inside a tool call is what used to hang the tutor's chat.
 */
async function countNotesMissingAudio(api: ApiClient, deckId: string, noteIds: string[], wait: AudioWaitOptions): Promise<number> {
  if (noteIds.length === 0) return 0;
  let missing = noteIds;
  for (let attempt = 0; attempt < wait.attempts && missing.length > 0; attempt++) {
    await sleep(wait.delayMs);
    try {
      const deck = await api.get<DeckWithNotes>(`/api/decks/${encodeURIComponent(deckId)}`);
      missing = notesMissingAudio(deck.notes ?? [], noteIds);
    } catch (err) {
      console.error('[content] deck re-read failed while counting audio:', err);
    }
  }
  return missing.length;
}

interface RelationshipRow {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: 'tutor' | 'student';
  status: string;
  requester?: { name?: string | null; email?: string | null };
  recipient?: { name?: string | null; email?: string | null };
}

/**
 * Why the caller may not send homework in this relationship, or null when they
 * are its (active) tutor. Uses GET /api/relationships, the same list
 * list_students shows as `students` / `my_tutors`.
 */
async function notTutorReason(api: ApiClient, userId: string, relationshipId: string): Promise<string | null> {
  const rels = await api.get<{ tutors?: RelationshipRow[]; students?: RelationshipRow[]; pending_incoming?: RelationshipRow[]; pending_outgoing?: RelationshipRow[] }>('/api/relationships');
  const all = [...(rels.students ?? []), ...(rels.tutors ?? []), ...(rels.pending_incoming ?? []), ...(rels.pending_outgoing ?? [])];
  const rel = all.find(r => r.id === relationshipId);
  if (!rel) return `No relationship ${relationshipId} on this account — take relationship_id from list_students (the students list, not my_tutors).`;
  const tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
  if (tutorId !== userId) {
    const tutor = rel.requester_role === 'tutor' ? rel.requester : rel.recipient;
    const who = tutor?.name || tutor?.email || 'someone else';
    return `In relationship ${relationshipId} you are the STUDENT (the tutor is ${who}); only the tutor can send homework. If you meant to make a deck for yourself, use create_deck + batch_add_notes.`;
  }
  if (rel.status !== 'active') return `Relationship ${relationshipId} is ${rel.status}, not active yet.`;
  return null;
}

export function registerStudentDeckTools(ctx: ToolContext, options: { audioWait?: AudioWaitOptions } = {}): void {
  const { server, api } = ctx;
  const wait = options.audioWait ?? DEFAULT_AUDIO_WAIT;

  server.tool(
    'create_deck_for_student',
    `Build a vocabulary deck for a student and send it as homework in one go: creates the deck and its notes in YOUR (the tutor's) account — every note gets three cards, and TTS audio is generated in the background (it reaches the student's copy automatically, so the call returns in seconds) — then shares a copy with the student (it lands in their app as "<name> (from tutor)" on their next sync and counts towards their Homework %). You must be the tutor in the relationship. Keep the words the student does not already have (batch_search_notes checks your own decks, list_student_lessons / the students tools show what they received). Notes with a missing field, tone-number pinyin or a duplicate hanzi in the batch are rejected up front and listed; a note the API refuses is skipped and listed under failed while the rest continue. Later additions go through add_words_to_student_deck (the returned shared_deck_id is what it needs).`,
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
      // Check the role BEFORE creating anything: sharing is tutor-only, and a
      // failed share used to leave a fully built deck orphaned in the account.
      const roleProblem = await notTutorReason(api, ctx.userId, relationship_id);
      if (roleProblem) return errorResult(`${roleProblem} Nothing was created.`);
      const deck = await api.post<ApiDeck>('/api/decks', { name: name.trim(), description: description?.trim() || undefined });
      const outcome = await createNotes(api, deck.id, clean);
      if (outcome.created.length === 0) {
        await api.delete(`/api/decks/${encodeURIComponent(deck.id)}`).catch(() => {});
        return errorResult(`No note could be added, so the deck was not kept:\n- ${outcome.failed.map(f => `${f.hanzi}: ${f.error}`).join('\n- ')}`);
      }
      const audioMissing = await countNotesMissingAudio(api, deck.id, outcome.created.map(n => n.id), wait);
      let shared: { id: string; target_deck_id: string; target_deck_name: string };
      try {
        shared = await api.post<{ id: string; target_deck_id: string; target_deck_name: string }>(
          `/api/relationships/${encodeURIComponent(relationship_id)}/share-deck`,
          { deck_id: deck.id },
        );
      } catch (err) {
        // Don't leave the half-finished deck behind.
        await api.delete(`/api/decks/${encodeURIComponent(deck.id)}`).catch(() => {});
        return errorResult(`The deck was built but could not be shared (${err instanceof Error ? err.message : String(err)}), so it was removed again. Check the relationship_id with list_students.`);
      }
      return jsonResult({
        tutor_deck_id: deck.id,
        student_deck_id: shared.target_deck_id,
        student_deck_name: shared.target_deck_name,
        shared_deck_id: shared.id,
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_generating: audioMissing,
        message: `Deck "${deck.name}" with ${outcome.created.length} word(s) is on its way to the student as "${shared.target_deck_name}".${audioMissing ? ` Audio for ${audioMissing} word(s) is still generating in the background and reaches the student's copy automatically — nothing more to do.` : ''}`,
      });
    }),
  );

  server.tool(
    'add_words_to_student_deck',
    `Add words to a deck you already shared with a student: the notes go into YOUR source deck (TTS generated in the background, copied to the student automatically), then the student's copy is brought up to date — new words are added to it, words it already has (matched by hanzi) keep their progress, and copies missing audio get your clip. Pass the shared_deck_id from create_deck_for_student or the students tools' homework list (not a plain deck id). An empty notes list just re-syncs the copy.`,
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
      const audioMissing = await countNotesMissingAudio(api, share.source_deck_id, outcome.created.map(n => n.id), wait);
      const update = await api.post<{ added: number; kept: number; audio_filled: number; updated?: number }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`,
      );
      return jsonResult({
        tutor_deck_id: share.source_deck_id,
        student_deck_id: share.target_deck_id,
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_generating: audioMissing,
        student_copy: update,
        message: `${outcome.created.length} word(s) added to "${share.source_deck_name}"; the student's copy gained ${update.added} new word(s), took the tutor's newer text on ${update.updated ?? 0}, kept ${update.kept}, and ${update.audio_filled} clip(s) were filled in.${audioMissing ? ` Audio for ${audioMissing} word(s) is still generating and reaches the student's copy automatically.` : ''}`,
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
