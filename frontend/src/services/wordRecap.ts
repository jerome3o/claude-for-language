/**
 * The word recap on the device (docs/STUDY_SESSION.md "Reader word recap"; rules in
 * shared/study/wordRecap.ts) — for a graded reader's reading AND for a "💬 Ask Claude" chat (the
 * same pass; the chat's words come from services/claudeChatRecap.ts). Its own small IndexedDB
 * (`reader-word-recap`):
 *   - `runs`: ONE run per reader (key = the reader id) or per chat (key = `chat:<thread id>`) — the
 *     words, the recap's answers and the switches. Kept across closes and days.
 *   - `adds`: words switched to "Add to my long-term review" waiting to become cards. Sent at once
 *     when online, else on the next sync (`flushRecapAdds`): the source's deck — "From my readers" /
 *     "From my chats" (made on first use, at the BOTTOM of the deck queue) —, the card standard's
 *     explanation + an example sentence (the story's / message's own sentence when it is short enough
 *     — POST /api/ai/enrich-words writes the rest), one POST /api/decks/:id/notes/batch
 *     (`skip_existing`, so a resend never duplicates), then Up next, so the chosen words are
 *     introduced first within the daily budget.
 * "⚡ Study it today" for a word he already has is a bump (services/studyBumps, offline-first).
 */
import Dexie, { type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addRecapMistakes, addRecapTap, answerRecap, chatRecapCount, chatRecapRun, chatRecapRunId, finishRecapRun, markRecapped,
  recapAvailable, recapBumpSource, recapChoices, recapDeck, recapEvent, recapKey, recapRightFirstTime, recapRunFor,
  recapSentenceClue, recapSource, recapUpNextSource, recapWords, restartRecap, setRecapKeep,
  type WordRecapPage, type WordRecapRun, type WordRecapSource, type WordRecapTap, type WordRecapWord,
} from '@shared/study/wordRecap';
import type { AskRecapWord } from '@shared/coach/askChat';
import type { ReadAloudResult } from '@shared/reader/readAloud';
import { autoPinyin } from '../utils/autoPinyin';
import { db } from '../db/database';
import { bumpNotes } from './studyBumps';
import { track } from './analytics';
import { createDeck, createNotesBatch, enrichWords, getDecks, glossWords, moveDeck, type BatchNoteInput } from '../api/client';
import { addUpNextApi } from '../api/upNext';
import { getRecapWords, useRecapWords } from './claudeChatRecap';

export interface PendingRecapAdd {
  id: string;
  /** The run's id (a reader id, or `chat:<thread>`). */
  reader_id: string;
  /** Absent = 'reader' (adds queued before chat recaps). Decides the deck and Up next's source. */
  source?: WordRecapSource;
  word: WordRecapWord;
  created_at: string;
}

class WordRecapDb extends Dexie {
  runs!: Table<WordRecapRun, string>;
  adds!: Table<PendingRecapAdd, string>;
  constructor() {
    super('reader-word-recap');
    this.version(1).stores({ runs: 'reader_id', adds: 'id, created_at' });
  }
}

let instance: WordRecapDb | null = null;
export function recapDb(): WordRecapDb {
  if (!instance) instance = new WordRecapDb();
  return instance;
}

const nowIso = () => new Date().toISOString();

// One read-modify-write at a time per reader (a tap and a take result can land together).
const chains = new Map<string, Promise<unknown>>();
export function updateRecapRun(readerId: string, fn: (run: WordRecapRun | null) => WordRecapRun | null): Promise<WordRecapRun | null> {
  const prev = chains.get(readerId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    const table = recapDb().runs;
    const cur = (await table.get(readerId).catch(() => undefined)) ?? null;
    const out = fn(cur);
    if (out && out !== cur) await table.put(out);
    return out;
  });
  chains.set(readerId, next);
  return next;
}

export async function getRecapRun(readerId: string): Promise<WordRecapRun | null> {
  return (await recapDb().runs.get(readerId).catch(() => undefined)) ?? null;
}

/** A run, live (undefined while loading, null = none): a reader id or `chatRecapRunId(thread)`. */
export function useRecapRun(readerId: string | undefined): WordRecapRun | null | undefined {
  return useLiveQuery(async () => (readerId ? (await recapDb().runs.get(readerId)) ?? null : null), [readerId]);
}

/**
 * What the reading view collects while a story is read. `openedAt` decides whether a word goes into
 * the stored run (carrying on) or starts a new one (the last one was finished before this opening).
 */
export interface RecapCollector {
  tap: (t: WordRecapTap) => void;
  take: (page: WordRecapPage, result: ReadAloudResult) => void;
  /** The story was finished: the run this reading finished (null = none — nothing to offer). */
  finish: () => Promise<WordRecapRun | null>;
}

export function recapCollector(readerId: string, openedAt: string): RecapCollector {
  // A word joins the stored run, or a new one — which only replaces the stored run once it has a word.
  const add = (fn: (run: WordRecapRun) => WordRecapRun) =>
    void updateRecapRun(readerId, (cur) => {
      const run = recapRunFor(cur, readerId, openedAt, nowIso());
      const next = fn(run);
      return run !== cur && next.words.length === 0 ? cur : next;
    }).catch(() => undefined);
  return {
    tap: (t) => add((run) => addRecapTap(run, t, nowIso())),
    take: (page, result) => add((run) => addRecapMistakes(run, page, result, nowIso())),
    finish: () => {
      let finished = false;
      return updateRecapRun(readerId, (cur) => {
        // Only a run this reading added to (or one carried on from before) is finished now.
        if (!cur || cur.reader_id !== readerId || (cur.finished_at && cur.finished_at <= openedAt)) return cur;
        finished = true;
        return finishRecapRun(cur, nowIso());
      }).then((r) => (finished ? r : null), () => null);
    },
  };
}

/** The reader view's collector for one opening. */
export function useRecapCollector(readerId: string): RecapCollector {
  const [c] = useState(() => recapCollector(readerId, nowIso()));
  return c;
}

// ---- the end-of-story offer (shown over whatever comes next: the session's next card, the pass…) ----

export interface RecapOffer {
  readerId: string;
  words: number;
  line: string;
}

let offer: RecapOffer | null = null;
const offerListeners = new Set<() => void>();
const emitOffer = () => offerListeners.forEach((l) => l());

export function offerRecap(o: RecapOffer | null): void {
  offer = o;
  emitOffer();
}

export function useRecapOffer(): RecapOffer | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    offerListeners.add(l);
    return () => void offerListeners.delete(l);
  }, []);
  return offer;
}

// ---- the recap's own writes ----

export const answerRecapWord = (readerId: string, key: string, right: boolean) =>
  updateRecapRun(readerId, (cur) => (cur ? answerRecap(cur, key, right, nowIso(), crypto.randomUUID()) : cur));

export const setRecapWordKeep = (readerId: string, key: string, on: boolean) =>
  updateRecapRun(readerId, (cur) => (cur ? setRecapKeep(cur, key, on) : cur));

export const restartRecapRun = (readerId: string) => updateRecapRun(readerId, (cur) => (cur ? restartRecap(cur) : cur));

/** Notes he already has, by recap key → note id. */
export async function ownedRecapNotes(run: WordRecapRun): Promise<Map<string, string>> {
  const keys = new Set(recapWords(run).map((w) => recapKey(w.hanzi)));
  const out = new Map<string, string>();
  await db.notes.each((n) => {
    const k = recapKey(n.hanzi ?? '');
    if (keys.has(k) && !out.has(k)) out.set(k, n.id);
  });
  return out;
}

export interface RecapDoneOutcome {
  added: number;
  bumped: number;
}

/**
 * Done: the switched-on words he already has are bumped, the new ones queued as cards (sent now when
 * online). The run is marked recapped; the source's finish event (`reader.word_recap_finish` /
 * `coach.ask_recap_finish`) is recorded. `runId` = a reader id or `chatRecapRunId(thread)`.
 */
export async function finishRecap(runId: string): Promise<RecapDoneOutcome> {
  const run = await getRecapRun(runId);
  if (!run) return { added: 0, bumped: 0 };
  const source = recapSource(run);
  const owned = await ownedRecapNotes(run);
  const { add, bump } = recapChoices(run, (k) => owned.has(k));
  if (bump.length) {
    await bumpNotes(bump.map((w) => owned.get(recapKey(w.hanzi))!), recapBumpSource(source)).catch(() => undefined);
  }
  if (add.length) {
    const now = nowIso();
    await recapDb().adds.bulkPut(add.map((word) => ({ id: `${runId}:${recapKey(word.hanzi)}`, reader_id: runId, source, word, created_at: now })));
  }
  await updateRecapRun(runId, (cur) => (cur ? markRecapped(cur, nowIso()) : cur));
  track(recapEvent(source, 'finish'), {
    words: recapWords(run).length,
    got_it_first_time: recapRightFirstTime(run),
    added: add.length,
    bumped: bump.length,
  });
  if (add.length && navigator.onLine) void flushRecapAdds().catch(() => undefined);
  return { added: add.length, bumped: bump.length };
}

export { recapAvailable };

// ---- a chat's recap (the "💬 Ask Claude" chat's words, services/claudeChatRecap.ts) ----

/**
 * Bring the chat's run up to date with the words collected in it (shared `chatRecapRun`: a run not
 * done carries on with the new words appended; after a Done only words met since). Written only
 * when it changed.
 */
export function openChatRecap(threadId: string, words: readonly AskRecapWord[] = getRecapWords(threadId)): Promise<WordRecapRun | null> {
  return updateRecapRun(chatRecapRunId(threadId), (cur) => {
    const next = chatRecapRun(threadId, words, cur, nowIso());
    if (cur && JSON.stringify({ ...next, started_at: '', finished_at: '' }) === JSON.stringify({ ...cur, started_at: '', finished_at: '' })) return cur;
    return next;
  });
}

/** "📝 N words to recap" in the chat's ⋯ menu: the chat's words not recapped yet (live). */
export function useChatRecapCount(threadId: string): number {
  const words = useRecapWords(threadId);
  const stored = useRecapRun(threadId === 'new' ? undefined : chatRecapRunId(threadId));
  return chatRecapCount(words, stored ?? null);
}

// ---- sending the chosen words ----

let flushing: Promise<{ sent: number }> | null = null;

/** Send the queued "Add to my long-term review" words (online; idempotent by hanzi). */
export function flushRecapAdds(): Promise<{ sent: number }> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function recapDeckId(source: WordRecapSource): Promise<string> {
  const { name, description } = recapDeck(source);
  const local = await db.decks.filter((d) => d.name === name).first().catch(() => undefined);
  if (local) return local.id;
  const remote = (await getDecks()).find((d) => d.name === name);
  if (remote) return remote.id;
  const deck = await createDeck(name, description);
  // Organisation only: the chosen words go on Up next, so the deck itself waits at the bottom.
  await moveDeck(deck.id, 'bottom').catch(() => undefined);
  return deck.id;
}

async function doFlush(): Promise<{ sent: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0 };
  const all = await recapDb().adds.orderBy('created_at').toArray().catch(() => [] as PendingRecapAdd[]);
  let sent = 0;
  // One deck per source: a reader's words go to "From my readers", a chat's to "From my chats".
  for (const source of ['reader', 'chat'] as const) {
    const rows = all.filter((r) => (r.source ?? 'reader') === source);
    if (rows.length) sent += (await flushSource(source, rows)).sent;
  }
  return { sent };
}

async function flushSource(source: WordRecapSource, rows: PendingRecapAdd[]): Promise<{ sent: number }> {
  const deckId = await recapDeckId(source);
  const notes: BatchNoteInput[] = rows.map(({ word }) => {
    // The story's own sentence when it suits the card (its English comes like any card sentence's).
    const clue = recapSentenceClue(word);
    return {
      hanzi: word.hanzi,
      pinyin: word.pinyin || autoPinyin(word.hanzi),
      english: word.gloss,
      ...(clue ? { sentence_clue: clue, sentence_clue_pinyin: autoPinyin(clue) } : {}),
    };
  });
  // Missing meanings first (device-segmented chips have no gloss).
  if (notes.some((n) => !n.english || !n.pinyin)) {
    try {
      const filled = await glossWords(notes.map((n) => ({ hanzi: n.hanzi, pinyin: n.pinyin || undefined, english: n.english || undefined })));
      filled.forEach((f, i) => {
        if (!notes[i].english) notes[i].english = f.english;
        if (!notes[i].pinyin) notes[i].pinyin = f.pinyin;
      });
    } catch {
      // the batch refuses a word without English; it stays queued for the next sync
    }
  }
  // The explanation (and a sentence where the story's was too long), to the card standard; best effort.
  for (let i = 0; i < notes.length; i += 15) {
    const chunk = notes.slice(i, i + 15);
    try {
      const out = await enrichWords(chunk.map((n) => ({ hanzi: n.hanzi, pinyin: n.pinyin, english: n.english, sentence_clue: n.sentence_clue })));
      for (const e of out) {
        const n = chunk.find((x) => x.hanzi === e.hanzi);
        if (!n) continue;
        if (e.fun_facts) n.fun_facts = e.fun_facts;
        if (!n.sentence_clue && e.sentence_clue) {
          n.sentence_clue = e.sentence_clue;
          n.sentence_clue_pinyin = e.sentence_clue_pinyin;
          n.sentence_clue_translation = e.sentence_clue_translation;
        }
      }
    } catch {
      // bare cards are fine: the card's ⋯ / the word check can fill them later
    }
  }
  const ready = notes.map((n, i) => ({ n, row: rows[i] })).filter(({ n }) => n.english && n.pinyin);
  if (ready.length === 0) return { sent: 0 };
  const result = await createNotesBatch(deckId, ready.map((r) => r.n), { skipExisting: true });
  const failed = new Set(result.failed.map((f) => f.index));
  const done = ready.filter((_, i) => !failed.has(i)).map((r) => r.row.id);
  await recapDb().adds.bulkDelete(done);
  const noteIds = result.created.map((c) => c.id);
  if (noteIds.length) {
    await addUpNextApi({ note_ids: noteIds, position: 'bottom', source: recapUpNextSource(source) }).catch(() => undefined);
  }
  return { sent: done.length };
}

/** For the sync: pending adds count. */
export async function pendingRecapAdds(): Promise<number> {
  return recapDb().adds.count().catch(() => 0);
}
