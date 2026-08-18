import { db, LocalNoteSentence } from '../db/database';
import { NoteSentence } from '../types';
import {
  API_BASE,
  getAuthHeaders,
  generateNoteSentenceSet,
  prefetchSentenceSets,
  explainNoteSentence,
  explainSentenceText,
  GenerateSentenceSetOptions,
} from '../api/client';
import { SentenceBriefExplanation } from '../types';
import { preCacheAudio } from './audioCache';

/**
 * Sentence sets: offline-first storage + sync.
 *
 * Reads always come from IndexedDB so studying works on the train. Generation
 * needs the network (it's an AI call), and writes straight back into the local
 * table so the new set is immediately available offline — including its audio,
 * which is pre-cached as soon as the set lands.
 *
 * Sync model: the server writes a note's set as a whole (every row gets the
 * same updated_at), so "give me everything touched since X" plus "replace all
 * local rows for each note_id in the response" is always consistent. There is
 * no local-only state to push back up.
 */

const SENTENCE_SYNC_KEY = 'sentenceSetsLastSync';
const PREFETCH_LAST_RUN_KEY = 'sentenceSetsLastPrefetch';
// One top-up per hour is plenty: each sweep queues a batch server-side, and
// several syncs can fire in a single session.
const PREFETCH_MIN_INTERVAL_MS = 60 * 60 * 1000;

function toLocal(sentence: NoteSentence): LocalNoteSentence {
  return {
    id: sentence.id,
    note_id: sentence.note_id,
    position: sentence.position,
    hanzi: sentence.hanzi,
    pinyin: sentence.pinyin,
    translation: sentence.translation,
    audio_url: sentence.audio_url,
    focus: (sentence.focus as string | null) ?? null,
    focus_note: sentence.focus_note,
    explanation: sentence.explanation ?? null,
    created_at: sentence.created_at,
    updated_at: sentence.updated_at,
    _synced_at: Date.now(),
  };
}

/** A note's sentence set from the local cache, easiest first. */
export async function getLocalNoteSentences(noteId: string): Promise<LocalNoteSentence[]> {
  const rows = await db.noteSentences.where('note_id').equals(noteId).toArray();
  return rows.sort((a, b) => a.position - b.position);
}

/** How many sentences each of these notes has locally (for badges/counts). */
export async function getLocalSentenceCounts(noteIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (noteIds.length === 0) return counts;
  const rows = await db.noteSentences.where('note_id').anyOf(noteIds).toArray();
  for (const row of rows) {
    counts.set(row.note_id, (counts.get(row.note_id) || 0) + 1);
  }
  return counts;
}

/** Replace the local rows for one note. */
export async function putLocalNoteSentences(
  noteId: string,
  sentences: NoteSentence[]
): Promise<LocalNoteSentence[]> {
  // Stamp the note id we're writing under: rows are deleted by note_id, so a
  // payload carrying a different one would leave orphans behind.
  const rows = sentences.map((sentence) => ({ ...toLocal(sentence), note_id: noteId }));
  await db.transaction('rw', db.noteSentences, async () => {
    const existing = await db.noteSentences.where('note_id').equals(noteId).primaryKeys();
    if (existing.length > 0) await db.noteSentences.bulkDelete(existing);
    if (rows.length > 0) await db.noteSentences.bulkPut(rows);
  });
  return rows.sort((a, b) => a.position - b.position);
}

export async function clearLocalNoteSentences(noteId: string): Promise<void> {
  const existing = await db.noteSentences.where('note_id').equals(noteId).primaryKeys();
  if (existing.length > 0) await db.noteSentences.bulkDelete(existing);
}

/** Download audio for a set so it plays offline. Best-effort. */
export function cacheSentenceAudio(sentences: Array<{ audio_url: string | null }>): void {
  const urls = sentences
    .map((s) => s.audio_url)
    .filter((url): url is string => !!url);
  if (urls.length === 0) return;
  preCacheAudio(urls).catch((err) =>
    console.error('[sentence-sets] Audio pre-cache failed:', err)
  );
}

/**
 * Generate a set for a note (requires network), store it locally, and start
 * caching its audio.
 */
export async function generateAndStoreSentenceSet(
  noteId: string,
  options?: GenerateSentenceSetOptions
): Promise<LocalNoteSentence[]> {
  const sentences = await generateNoteSentenceSet(noteId, options);
  const stored = await putLocalNoteSentences(noteId, sentences);
  cacheSentenceAudio(stored);
  return stored;
}

/**
 * Notes a generation has already been started for in this session, so a
 * repeated "Again" on the same card doesn't stack up duplicate work.
 */
const generationStarted = new Set<string>();

/**
 * Make sure a note has a sentence set, generating one now if it doesn't.
 *
 * Called when a card is failed: getting a word wrong is a strong signal you
 * want more exposure to it, and "Again" puts the card back about a minute
 * later — long enough for a set to be generated and stored, so it's waiting
 * when the card comes back.
 *
 * Fire-and-forget: never throws, never blocks the card transition.
 */
export async function ensureSentenceSetForNote(noteId: string): Promise<void> {
  if (!navigator.onLine || generationStarted.has(noteId)) return;

  try {
    const existing = await getLocalNoteSentences(noteId);
    if (existing.length > 0) return;

    generationStarted.add(noteId);
    await generateAndStoreSentenceSet(noteId, { count: 6 });
  } catch (err) {
    // Let a later "Again" on the same card try again — a failure here is
    // usually a dropped connection mid-session.
    generationStarted.delete(noteId);
    console.error('[sentence-sets] Background generation failed for', noteId, err);
  }
}

/**
 * Pull every sentence changed since the last run into IndexedDB.
 * Called as part of the background sync; safe to call when offline (throws,
 * caller swallows).
 */
export async function syncSentenceSets(): Promise<{ synced: number }> {
  const since = localStorage.getItem(SENTENCE_SYNC_KEY);
  const query = since ? `?since=${encodeURIComponent(since)}` : '';

  const response = await fetch(`${API_BASE}/api/sentences/changes${query}`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to sync sentence sets: ${response.status}`);
  }
  const data = (await response.json()) as {
    sentences: NoteSentence[];
    server_time: string;
  };

  const sentences = data.sentences || [];
  if (sentences.length > 0) {
    // Group by note so each touched note's local set is replaced wholesale —
    // that also drops rows the server no longer has (e.g. a shorter new set).
    const byNote = new Map<string, NoteSentence[]>();
    for (const sentence of sentences) {
      const list = byNote.get(sentence.note_id);
      if (list) list.push(sentence);
      else byNote.set(sentence.note_id, [sentence]);
    }

    await db.transaction('rw', db.noteSentences, async () => {
      for (const [noteId, rows] of byNote) {
        const existing = await db.noteSentences.where('note_id').equals(noteId).primaryKeys();
        if (existing.length > 0) await db.noteSentences.bulkDelete(existing);
        await db.noteSentences.bulkPut(rows.map(toLocal));
      }
    });
  }

  // Drop sets whose note is gone (deleted decks/notes clean themselves up).
  await pruneOrphanedSentences();

  localStorage.setItem(SENTENCE_SYNC_KEY, data.server_time);
  return { synced: sentences.length };
}

/** Remove cached sentences whose note no longer exists locally. */
async function pruneOrphanedSentences(): Promise<void> {
  const [sentenceNoteIds, noteIds] = await Promise.all([
    db.noteSentences.orderBy('note_id').uniqueKeys(),
    db.notes.toCollection().primaryKeys(),
  ]);
  const known = new Set(noteIds as string[]);
  const orphans = (sentenceNoteIds as string[]).filter((id) => !known.has(id));
  if (orphans.length === 0) return;
  const keys = await db.noteSentences.where('note_id').anyOf(orphans).primaryKeys();
  if (keys.length > 0) await db.noteSentences.bulkDelete(keys);
}

/**
 * Ask the server to pre-generate sets for notes that don't have one, starting
 * with the notes the learner is about to study.
 *
 * Generation happens in a worker queue, so this returns as soon as the work is
 * enqueued; the sets arrive on a later sync. Bounded per call server-side, and
 * throttled here, so a big collection fills in over days rather than at once.
 */
export async function topUpSentenceSets(): Promise<{ queued: number; remaining: number } | null> {
  if (!navigator.onLine) return null;

  const lastRun = Number(localStorage.getItem(PREFETCH_LAST_RUN_KEY) || 0);
  if (Date.now() - lastRun < PREFETCH_MIN_INTERVAL_MS) return null;

  const priority = await getUpcomingNoteIds();
  const result = await prefetchSentenceSets(priority);
  localStorage.setItem(PREFETCH_LAST_RUN_KEY, String(Date.now()));
  return result;
}

/**
 * Notes whose cards come up soonest — the ones worth generating first.
 * Learning and due cards first, then the nearest future reviews.
 */
async function getUpcomingNoteIds(limit = 120): Promise<string[]> {
  const now = Date.now();
  const cards = await db.cards
    .where('due_timestamp')
    .belowOrEqual(now + 24 * 60 * 60 * 1000)
    .limit(limit * 3)
    .toArray();

  const newCards = cards.length < limit
    ? await db.cards.where('queue').equals(0).limit(limit * 2).toArray()
    : [];

  const ordered = [...cards, ...newCards].sort(
    (a, b) => (a.due_timestamp ?? Infinity) - (b.due_timestamp ?? Infinity)
  );

  const noteIds: string[] = [];
  const seen = new Set<string>();
  for (const card of ordered) {
    if (seen.has(card.note_id)) continue;
    seen.add(card.note_id);
    noteIds.push(card.note_id);
    if (noteIds.length >= limit) break;
  }
  return noteIds;
}

/**
 * Fetch (or generate) the brief breakdown of one sentence and cache it on the
 * local row, so a second tap is instant and works offline.
 */
export async function getSentenceExplanation(
  sentenceId: string
): Promise<SentenceBriefExplanation> {
  const local = await db.noteSentences.get(sentenceId);
  if (local?.explanation) {
    try {
      return JSON.parse(local.explanation) as SentenceBriefExplanation;
    } catch {
      // Corrupt cache — fall through and refetch
    }
  }

  const explanation = await explainNoteSentence(sentenceId);
  await db.noteSentences.update(sentenceId, {
    explanation: JSON.stringify(explanation),
  });
  return explanation;
}

/**
 * Same breakdown for a sentence with no row of its own — the card's example
 * sentence. Cached locally by its text, so it is instant and offline after the
 * first look, and a regenerated clue simply gets a new cache key.
 */
export async function getTextExplanation(sentence: {
  hanzi: string;
  pinyin?: string | null;
  translation?: string | null;
}): Promise<SentenceBriefExplanation> {
  const cached = await db.sentenceTextExplanations.get(sentence.hanzi);
  if (cached) {
    try {
      return JSON.parse(cached.explanation) as SentenceBriefExplanation;
    } catch {
      // Corrupt cache — fall through and refetch
    }
  }

  const explanation = await explainSentenceText(sentence);
  await db.sentenceTextExplanations.put({
    key: sentence.hanzi,
    explanation: JSON.stringify(explanation),
    cached_at: Date.now(),
  });
  return explanation;
}

/**
 * What this device actually holds, for the coverage overview: sets are only
 * usable offline once they've synced down, so "the server has 800 sets" and
 * "this phone has 800 sets" are different questions.
 */
export async function getLocalSentenceSetStats(): Promise<{
  sentences: number;
  notes: number;
  last_sync: string | null;
}> {
  const [sentences, noteIds] = await Promise.all([
    db.noteSentences.count(),
    db.noteSentences.orderBy('note_id').uniqueKeys(),
  ]);
  return {
    sentences,
    notes: noteIds.length,
    last_sync: localStorage.getItem(SENTENCE_SYNC_KEY),
  };
}

/** Forget the sync cursor so the next sync re-downloads every sentence. */
export function resetSentenceSetSyncCursor(): void {
  localStorage.removeItem(SENTENCE_SYNC_KEY);
}
