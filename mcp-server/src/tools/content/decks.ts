/**
 * Decks for students: build a deck in the TUTOR's account through the API (so
 * every note gets TTS the normal way) — nothing is sent unless the tutor asked
 * (`send_now` + `confirm`) — or top up a deck already shared, sending the new
 * words to the student's copy only on an explicit `update_student_copy` + `confirm`.
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
import { checkWarningsMessage, type CheckWarning } from '../checks.js';
import { normalizeNotes, notesMissingAudio, type NoteInput } from './specs.js';
import { CARD_STANDARD_SHORT } from '../../../../shared/cards/standard';
import { NOT_SENT, SEND_DUE_DATE, SEND_MODE, SEND_TODAY, STUDENT_NAME, assignmentSummary, describeSend, resolveStudent, sendAsHomework, sentTo, type ResolvedStudent, type Sent } from '../homework-send.js';

const RELATIONSHIP_ID = z.string().describe('The tutor–student relationship id (from list_students or the students tools)');

const noteShape = z.object({
  hanzi: z.string().describe('Chinese characters (simplified). ONE clean form — no slashes, parentheses, brackets, ellipses or blanks (rejected); alternatives go in fun_facts'),
  pinyin: z.string().describe('Pinyin with tone marks (nǐ hǎo) — tone numbers are rejected'),
  english: z.string().describe('English meaning'),
  fun_facts: z.string().optional().describe(`The explanation: every word of a sentence (汉字 (pīnyīn) meaning) or every character of a word, then usage / common mistake / contrast, and any alternatives kept off the card. ${CARD_STANDARD_SHORT}`),
  sentence_clue: z.string().optional().describe('One short example sentence in Chinese using the word (gets its own TTS)'),
});

export interface AudioWaitOptions {
  /** How many times to re-read the deck to count clips still generating (for the report only). */
  attempts: number;
  delayMs: number;
}

/** One quick look, so the reply can say how many clips are still rendering. */
const DEFAULT_AUDIO_WAIT: AudioWaitOptions = { attempts: 1, delayMs: 800 };

interface ApiDeck { id: string; name: string; description?: string | null }
interface ApiNote { id: string; hanzi: string; audio_url: string | null }
interface DeckWithNotes extends ApiDeck { notes: ApiNote[] }

interface CreateNotesOutcome {
  created: Array<{ id: string; hanzi: string }>;
  failed: Array<{ hanzi: string; error: string }>;
  /** The word check's possible issues (nothing is changed by it). */
  check_warnings?: CheckWarning[];
}

/** What POST /api/decks/:id/notes/batch returns: each row stands alone. */
interface BatchCreateResponse {
  created: ApiNote[];
  failed: Array<{ index: number; hanzi: string; error: string }>;
  check_warnings?: CheckWarning[];
}

/**
 * One batch POST: the API creates each note with its cards (sentence_clue
 * included, so the sentence gets its own clip), queues TTS + sentence sets,
 * and reports per-row failures while the rest are created. A failure of the
 * request itself (deck not found, network) counts against every note, so the
 * caller's "nothing was created" path still works.
 */
async function createNotes(api: ApiClient, deckId: string, notes: NoteInput[]): Promise<CreateNotesOutcome> {
  if (notes.length === 0) return { created: [], failed: [] };
  try {
    // ?check=sync: the word check runs now and its warnings come back with the notes.
    const result = await api.post<BatchCreateResponse>(`/api/decks/${encodeURIComponent(deckId)}/notes/batch?check=sync`, {
      notes: notes.map(note => ({
        hanzi: note.hanzi,
        pinyin: note.pinyin,
        english: note.english,
        fun_facts: note.fun_facts,
        sentence_clue: note.sentence_clue,
      })),
    });
    return {
      created: (result.created ?? []).map(n => ({ id: n.id, hanzi: n.hanzi })),
      failed: (result.failed ?? []).map(f => ({ hanzi: f.hanzi, error: f.error })),
      check_warnings: result.check_warnings ?? [],
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { created: [], failed: notes.map(n => ({ hanzi: n.hanzi, error })) };
  }
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

export function registerStudentDeckTools(ctx: ToolContext, options: { audioWait?: AudioWaitOptions } = {}): void {
  const { server, api } = ctx;
  const wait = options.audioWait ?? DEFAULT_AUDIO_WAIT;

  const createDeckSchema = {
    name: z.string().min(1).describe('Deck name (when sent, the student sees it as "<name> (from tutor)")'),
    description: z.string().optional().describe('One line on what the deck covers'),
    notes: z.array(noteShape).min(1).describe('The words to put in the deck'),
    for_relationship_id: z.string().optional().describe('Optional: the student this deck is being made FOR (relationship_id from list_students). Only labels the deck and checks you tutor them — it does NOT send anything.'),
    send_now: z.boolean().optional().describe('Default false: the deck stays in your account. true sends it at once — ONLY when the tutor explicitly asked to send this deck to this named student in this conversation; then relationship_id and confirm: true are required too.'),
    relationship_id: z.string().optional().describe('With send_now: the student to send it to (relationship_id from list_students).'),
    student_name: STUDENT_NAME,
    confirm: z.boolean().optional().describe('With send_now: must be true — only after the tutor explicitly asked to send this deck to this named student.'),
    mode: SEND_MODE,
    due_date: SEND_DUE_DATE,
    priority: z.enum(['core', 'non_urgent']).optional().describe('With send_now, long-term part (mode both / fsrs): "core" (default) = top of the student\'s queue, studied next; "non_urgent" = bottom.'),
    skip_known: z.boolean().optional().describe('With send_now: leave the words the student already has out of their copy (default true; `skipped_known` lists them).'),
    today: SEND_TODAY,
  };
  type CreateDeckArgs = {
    name: string; description?: string; notes: NoteInput[]; for_relationship_id?: string; send_now?: boolean; relationship_id?: string;
    student_name?: string; confirm?: boolean; mode?: 'one_off' | 'fsrs' | 'both'; due_date?: string; priority?: 'core' | 'non_urgent'; skip_known?: boolean; today?: string;
  };

  const createHomeworkDeck = (args: CreateDeckArgs) => guard(async () => {
    const { name, description, notes, for_relationship_id, send_now, relationship_id, student_name, confirm, mode, due_date, priority, skip_known, today } = args;
    if (send_now && (!relationship_id || confirm !== true)) {
      return errorResult('send_now needs relationship_id (the student, from list_students) AND confirm: true — and only when the tutor explicitly asked to send this deck to that student. Nothing was created. To just make the deck, call again without send_now.');
    }
    const { notes: clean, rejected } = normalizeNotes(notes);
    if (clean.length === 0) {
      return errorResult(`No usable notes:\n- ${rejected.map(r => `${r.hanzi}: ${r.reason}`).join('\n- ')}`);
    }
    // Check the student BEFORE creating anything: a failed send used to leave a
    // fully built deck orphaned in the account.
    let target: ResolvedStudent | null = null;
    let intendedFor: ResolvedStudent | null = null;
    try {
      if (send_now) target = await resolveStudent(api, ctx.userId, relationship_id!, student_name);
      else if (for_relationship_id) intendedFor = await resolveStudent(api, ctx.userId, for_relationship_id, student_name);
    } catch (err) {
      return errorResult(`${err instanceof Error ? err.message : String(err)} Nothing was created.`);
    }
    const deck = await api.post<ApiDeck>('/api/decks', { name: name.trim(), description: description?.trim() || undefined });
    const outcome = await createNotes(api, deck.id, clean);
    if (outcome.created.length === 0) {
      await api.delete(`/api/decks/${encodeURIComponent(deck.id)}`).catch(() => {});
      return errorResult(`No note could be added, so the deck was not kept:\n- ${outcome.failed.map(f => `${f.hanzi}: ${f.error}`).join('\n- ')}`);
    }
    const audioMissing = await countNotesMissingAudio(api, deck.id, outcome.created.map(n => n.id), wait);
    const audioNote = audioMissing ? ` Audio for ${audioMissing} word(s) is still generating in the background${target ? " and reaches the student's copy automatically" : ''}.` : '';

    if (!target) {
      const who = intendedFor ? intendedFor.name : '<student>';
      return jsonResult({
        sent: false,
        tutor_deck_id: deck.id,
        deck_name: deck.name,
        ...(intendedFor ? { intended_for: intendedFor } : {}),
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_generating: audioMissing,
        check_warnings: outcome.check_warnings ?? [],
        message: `Deck "${deck.name}" with ${outcome.created.length} word(s) — ${NOT_SENT.replace('<student>', who)}${audioNote} When the tutor asks, send it with share_deck_with_student(relationship_id${intendedFor ? `="${intendedFor.relationship_id}"` : ''}, deck_id="${deck.id}", confirm: true).${checkWarningsMessage(outcome.check_warnings ?? [])}`,
      });
    }

    let sent: Sent;
    try {
      sent = await sendAsHomework(api, target.relationship_id, 'deck', deck.id, { mode, due_date, priority: priority ?? 'core', skip_known, today });
    } catch (err) {
      return errorResult(`The deck "${deck.name}" (id=${deck.id}) was saved in your account but could NOT be sent (${err instanceof Error ? err.message : String(err)}). Nothing reached ${target.name}.`);
    }
    const studentDeckName = sent.copy?.target_name ?? `${deck.name} (from tutor)`;
    const skippedKnown = sent.result.skipped.flatMap(s => s.hanzi);
    return jsonResult({
      sent: true,
      sent_to: target,
      tutor_deck_id: deck.id,
      student_deck_id: sent.copy?.target_id ?? sent.result.assignments[0].target_id,
      student_deck_name: studentDeckName,
      shared_deck_id: sent.copy?.share_id ?? null,
      mode: sent.mode,
      due_date: sent.due_date,
      assignments: assignmentSummary(sent.result.assignments),
      skipped_known: skippedKnown,
      created: outcome.created.length,
      failed: outcome.failed,
      rejected,
      audio_generating: audioMissing,
      check_warnings: outcome.check_warnings ?? [],
      message: sentTo(target.name, `deck "${deck.name}" with ${outcome.created.length} word(s) as "${studentDeckName}", ${describeSend(sent.mode, sent.due_date)}.${skippedKnown.length ? ` Left out ${skippedKnown.length} word(s) they already have.` : ''}${audioNote}`) + checkWarningsMessage(outcome.check_warnings ?? []),
    });
  });

  server.tool(
    'create_homework_deck',
    `Make a vocabulary deck in YOUR (the tutor's) account — homework you can send later. Every note gets three cards, TTS audio is generated in the background, the call returns in seconds. NOTHING is sent: the deck stays in your Decks until you send it with share_deck_with_student (or the app's Send homework sheet). Use \`for_relationship_id\` to say which student it is for (it is only a label). Only when the tutor explicitly asked, in this conversation, to send THIS deck to a named student may you pass \`send_now: true\` with \`relationship_id\` and \`confirm: true\` — it is then sent as homework like share_deck_with_student (mode, due_date, priority, skip_known). Check the words first (batch_search_notes checks your own decks; the students tools show what a student has). Notes with a missing field, tone-number pinyin or a duplicate hanzi are rejected up front and listed; a note the API refuses is skipped and listed under failed while the rest continue.`,
    createDeckSchema,
    async (args) => createHomeworkDeck(args as CreateDeckArgs),
  );

  server.tool(
    'create_deck_for_student',
    `DEPRECATED — use create_homework_deck (same parameters). Kept so old chats keep working, but it no longer sends by itself: it makes the deck in YOUR account only. \`relationship_id\` alone is just a label (like for_relationship_id); the deck is sent only with \`send_now: true\` AND \`confirm: true\`, and only when the tutor explicitly asked to send it to that named student.`,
    createDeckSchema,
    async (args) => {
      const a = args as CreateDeckArgs;
      return createHomeworkDeck(a.send_now ? a : { ...a, for_relationship_id: a.for_relationship_id ?? a.relationship_id, relationship_id: undefined });
    },
  );

  server.tool(
    'add_words_to_student_deck',
    `Add words to the source deck (in YOUR account) of a deck you already shared with a student. By default the student's copy is NOT touched: the words wait in your deck until the tutor asks to update the student's copy (update_student_deck_copy, or call this again with update_student_copy + confirm). With \`update_student_copy: true\` and \`confirm: true\` — only when the tutor explicitly asked — the student's copy is brought up to date at once: new words are added to it, words it already has (matched by hanzi) keep their progress, copies missing audio get your clip. Pass the shared_deck_id from list_student_homework (not a plain deck id; for a deck never shared, use batch_add_notes).`,
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().describe('The share record id (shared_deck_id), from list_student_homework or a send result'),
      notes: z.array(noteShape).describe('The words to add (may be empty with update_student_copy to just re-sync the student\'s copy)'),
      update_student_copy: z.boolean().optional().describe('Default false. true also SENDS the new words to the student\'s copy — only when the tutor explicitly asked; needs confirm: true.'),
      student_name: STUDENT_NAME,
      confirm: z.boolean().optional().describe('With update_student_copy: must be true — only after the tutor explicitly asked to update this student\'s copy.'),
    },
    async ({ relationship_id, shared_deck_id, notes, update_student_copy, student_name, confirm }) => guard(async () => {
      if (update_student_copy && confirm !== true) {
        return errorResult('update_student_copy needs confirm: true — and only when the tutor explicitly asked to update the student\'s copy. Nothing was changed. To just add the words to your deck, call again without update_student_copy.');
      }
      const target = update_student_copy ? await resolveStudent(api, ctx.userId, relationship_id, student_name) : null;
      const shares = await api.get<Array<{ id: string; source_deck_id: string; target_deck_id: string; source_deck_name: string }>>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks`,
      );
      const share = shares.find(s => s.id === shared_deck_id);
      if (!share) {
        const known = shares.map(s => `${s.id} (${s.source_deck_name})`).join(', ') || 'none';
        return errorResult(`No shared deck ${shared_deck_id} in this relationship. Shared decks: ${known}.`);
      }
      const { notes: clean, rejected } = normalizeNotes(notes);
      const outcome: CreateNotesOutcome = clean.length > 0 ? await createNotes(api, share.source_deck_id, clean) : { created: [], failed: [] };
      const audioMissing = await countNotesMissingAudio(api, share.source_deck_id, outcome.created.map(n => n.id), wait);
      if (!target) {
        return jsonResult({
          sent: false,
          tutor_deck_id: share.source_deck_id,
          created: outcome.created.length,
          failed: outcome.failed,
          rejected,
          audio_generating: audioMissing,
          check_warnings: outcome.check_warnings ?? [],
          message: `${outcome.created.length} word(s) added to your deck "${share.source_deck_name}". ${NOT_SENT} The student's copy is unchanged until the tutor asks — then update_student_deck_copy(relationship_id="${relationship_id}", shared_deck_id="${shared_deck_id}", confirm: true).${checkWarningsMessage(outcome.check_warnings ?? [])}`,
        });
      }
      const update = await api.post<{ added: number; kept: number; audio_filled: number; updated?: number }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`,
      );
      return jsonResult({
        sent: true,
        sent_to: target,
        tutor_deck_id: share.source_deck_id,
        student_deck_id: share.target_deck_id,
        created: outcome.created.length,
        failed: outcome.failed,
        rejected,
        audio_generating: audioMissing,
        student_copy: update,
        message: sentTo(target.name, `${outcome.created.length} word(s) added to "${share.source_deck_name}"; their copy gained ${update.added} new word(s), took your newer text on ${update.updated ?? 0}, kept ${update.kept}, and ${update.audio_filled} clip(s) were filled in.${audioMissing ? ` Audio for ${audioMissing} word(s) is still generating and reaches their copy automatically.` : ''}`),
      });
    }),
  );

  server.tool(
    'get_starter_deck',
    'Get (creating it if needed) your built-in "Starter Chinese" deck — 15 first words with tone-marked pinyin, an example sentence each and TTS. Idempotent: returns the existing deck by name. Its id is what you pass to share_deck_with_student or invites for a brand-new student. Nothing is sent.',
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
