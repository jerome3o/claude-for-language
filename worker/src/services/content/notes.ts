/**
 * Notes: the semantic operations every caller uses (routes, Ask Claude and
 * coach tools, imports, the starter deck, tutor copies, the MCP server via the
 * API). Persistence is db/queries; this layer adds the side effects that used
 * to be wired differently on every path: cards, TTS, clue audio, sentence
 * sets, shared-copy propagation, tombstones, R2 clean-up.
 */
import type { Env, Note, NoteWithCards } from '../../types';
import * as db from '../../db/queries';
import { ContentError } from './decks';
import {
  deleteUnreferencedAudio,
  enqueueNoteAudio,
  enqueueSentenceSet,
  ensureSentenceClueAudio,
  generateNoteAudioNow,
} from './audio';
import type { Background, CreateNoteOptions, NoteInput, NotePatch } from './types';

const TONE_NUMBER = /[a-zü]+[1-5]\b/i;

/** Trim and check a note before it is stored. Returns the reason it is unusable, else null. */
export function noteInputProblem(input: Partial<NoteInput>): string | null {
  if (!input.hanzi?.trim()) return 'hanzi is required';
  if (!input.pinyin?.trim()) return 'pinyin is required';
  if (!input.english?.trim()) return 'english is required';
  if (TONE_NUMBER.test(input.pinyin)) return 'pinyin must use tone marks (nǐ hǎo), not tone numbers';
  return null;
}

function cleanInput(input: NoteInput): NoteInput {
  const t = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() || null);
  return {
    hanzi: input.hanzi.trim(),
    pinyin: input.pinyin.trim(),
    english: input.english.trim(),
    fun_facts: t(input.fun_facts),
    context: t(input.context),
    sentence_clue: t(input.sentence_clue),
    sentence_clue_pinyin: t(input.sentence_clue_pinyin),
    sentence_clue_translation: t(input.sentence_clue_translation),
    alternatives: input.alternatives,
    audio_url: input.audio_url,
    audio_provider: input.audio_provider,
  };
}

async function runNoteEffects(env: Env, noteId: string, hasClue: boolean, options: CreateNoteOptions): Promise<void> {
  const audio = options.audio ?? 'background';
  const bg = options.bg;
  const later = (p: Promise<unknown>) => (bg ? bg.waitUntil(p) : p);

  if (audio === 'await') {
    await generateNoteAudioNow(env, noteId);
  } else if (audio === 'background') {
    await later(generateNoteAudioNow(env, noteId).catch(err => console.error('[content] audio failed for', noteId, err)));
  } else if (audio === 'queue') {
    await enqueueNoteAudio(env, noteId);
  } else if (audio === 'none' && hasClue) {
    // The caller made the word clip; the sentence still needs one.
    await later(ensureSentenceClueAudio(env, noteId).catch(() => false));
  }

  if (options.sentences ?? true) {
    await later(enqueueSentenceSet(env, noteId));
  }
}

/** Create one note in a deck the user owns, with its cards and side effects. */
export async function createNote(
  env: Env,
  userId: string,
  deckId: string,
  input: NoteInput,
  options: CreateNoteOptions = {}
): Promise<NoteWithCards> {
  const deck = await db.getDeckById(env.DB, deckId, userId);
  if (!deck) throw new ContentError('Deck not found', 404);
  const problem = noteInputProblem(input);
  if (problem) throw new ContentError(problem);
  const clean = cleanInput(input);
  const note = await db.createNote(env.DB, deckId, clean);
  await runNoteEffects(env, note.id, !!clean.sentence_clue, options);
  return note;
}

export interface CreateNotesResult {
  created: NoteWithCards[];
  failed: Array<{ index: number; hanzi: string; error: string }>;
}

/**
 * Create many notes in one deck. Each row is validated and stored on its own
 * so one bad line never sinks the batch; failures come back by index. Audio
 * defaults to the queue, which is the only mode that survives a big batch.
 */
export async function createNotes(
  env: Env,
  userId: string,
  deckId: string,
  inputs: NoteInput[],
  options: CreateNoteOptions = {}
): Promise<CreateNotesResult> {
  const deck = await db.getDeckById(env.DB, deckId, userId);
  if (!deck) throw new ContentError('Deck not found', 404);
  const result: CreateNotesResult = { created: [], failed: [] };
  const opts = { audio: 'queue' as const, ...options };
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const problem = noteInputProblem(input ?? {});
    if (problem) {
      result.failed.push({ index: i, hanzi: input?.hanzi ?? '', error: problem });
      continue;
    }
    try {
      const clean = cleanInput(input);
      const note = await db.createNote(env.DB, deckId, clean);
      await runNoteEffects(env, note.id, !!clean.sentence_clue, opts);
      result.created.push(note);
    } catch (err) {
      result.failed.push({ index: i, hanzi: input.hanzi, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/**
 * Edit a note the user owns. A changed example sentence gets a new clip; a
 * changed word gets a new word clip (the old one said something else).
 */
export async function updateNote(
  env: Env,
  userId: string,
  noteId: string,
  patch: NotePatch,
  bg?: Background
): Promise<Note | null> {
  const before = await db.getNoteById(env.DB, noteId, userId);
  if (!before) return null;
  if (patch.pinyin !== undefined && TONE_NUMBER.test(patch.pinyin)) {
    throw new ContentError('pinyin must use tone marks (nǐ hǎo), not tone numbers');
  }
  for (const key of ['hanzi', 'pinyin', 'english'] as const) {
    if (patch[key] !== undefined && !patch[key]!.trim()) throw new ContentError(`${key} cannot be empty`);
  }

  const note = await db.updateNote(env.DB, noteId, {
    hanzi: patch.hanzi?.trim(),
    pinyin: patch.pinyin?.trim(),
    english: patch.english?.trim(),
    funFacts: patch.fun_facts ?? undefined,
    sentenceClue: patch.sentence_clue ?? undefined,
    sentenceCluePinyin: patch.sentence_clue_pinyin ?? undefined,
    sentenceClueTranslation: patch.sentence_clue_translation ?? undefined,
    sentenceClueAudioUrl: patch.sentence_clue_audio_url ?? undefined,
    pinyinOnly: patch.pinyin_only,
    alternatives: patch.alternatives,
  });
  if (!note) return null;

  const later = (p: Promise<unknown>) => (bg ? bg.waitUntil(p) : p);
  const hanziChanged = patch.hanzi !== undefined && note.hanzi !== before.hanzi;
  const clueChanged =
    patch.sentence_clue_audio_url === undefined &&
    !!note.sentence_clue &&
    note.sentence_clue !== before.sentence_clue;
  if (hanziChanged) {
    await later(generateNoteAudioNow(env, noteId, { force: true }).catch(err => console.error('[content] audio failed for', noteId, err)));
  } else if (clueChanged || (note.sentence_clue && !note.sentence_clue_audio_url)) {
    await later(ensureSentenceClueAudio(env, noteId, { force: clueChanged }).catch(() => false));
  }
  return note;
}

/** Delete a note the user owns: row + cards, tombstone, and clips nothing else uses. */
export async function deleteNote(env: Env, userId: string, noteId: string, bg?: Background): Promise<boolean> {
  const note = await db.getNoteById(env.DB, noteId, userId);
  if (!note) return false;
  const sentences = await env.DB
    .prepare('SELECT audio_url FROM note_sentences WHERE note_id = ? AND audio_url IS NOT NULL')
    .bind(noteId)
    .all<{ audio_url: string }>();
  const keys = [note.audio_url, note.sentence_clue_audio_url, ...(sentences.results || []).map(s => s.audio_url)];
  await db.deleteNote(env.DB, noteId, userId);
  const cleanup = deleteUnreferencedAudio(env, keys).catch(err => console.error('[deleteNote] audio cleanup failed', err));
  if (bg) bg.waitUntil(cleanup); else await cleanup;
  return true;
}

/** Move notes between the user's own decks; scheduling and history travel with them. */
export async function moveNotes(d1: D1Database, userId: string, noteIds: string[], targetDeckId: string): Promise<string[]> {
  try {
    return await db.moveNotes(d1, userId, noteIds, targetDeckId);
  } catch (err) {
    if (err instanceof Error && err.message === 'Target deck not found') throw new ContentError(err.message, 404);
    throw err;
  }
}
