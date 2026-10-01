/**
 * Reader word chips on the device (shared/reader/words.ts; server side in
 * worker/src/services/reader-words.ts).
 *
 * Words arrive with the readers in sync (`pages[].words`) and live on the
 * cached reader in IndexedDB, so chips work offline. A page still without
 * them gets them lazily: opening the reader asks `POST /api/reader-words/backfill`
 * for that reader (one call, deduplicated), and every sync tops up a few more
 * pages until the account has none left. Until they arrive the page is plain
 * text — reading is never blocked.
 *
 * "More about this word" explanations are cached on the device too (in the
 * sentence-explanation table, keyed `reader-word:<word>|<sentence>`).
 */
import { db } from '../db/database';
import { backfillReaderWords, explainReaderWord } from '../api/client';
import { wordsMatchText, type ReaderWord, type ReaderWordExplanation } from '@shared/reader/words';

type PageWordsMap = Map<string, ReaderWord[]>;

/** Words for these pages onto the locally cached readers. */
export async function storeLocalPageWords(pages: Array<{ id: string; reader_id: string; words: ReaderWord[] }>): Promise<void> {
  const byReader = new Map<string, Map<string, ReaderWord[]>>();
  for (const p of pages) {
    const m = byReader.get(p.reader_id) ?? new Map<string, ReaderWord[]>();
    m.set(p.id, p.words);
    byReader.set(p.reader_id, m);
  }
  for (const [readerId, words] of byReader) {
    const reader = await db.readers.get(readerId);
    if (!reader) continue;
    await db.readers.update(readerId, {
      pages: reader.pages.map((p) => {
        const w = words.get(p.id);
        return w && wordsMatchText(w, p.content_chinese) ? { ...p, words: w } : p;
      }),
    });
  }
}

/** The page's words from the device cache (null when missing or stale). */
export async function localPageWords(readerId: string, pageId: string, text: string): Promise<ReaderWord[] | null> {
  const reader = await db.readers.get(readerId).catch(() => undefined);
  const words = reader?.pages.find((p) => p.id === pageId)?.words;
  return words && wordsMatchText(words, text) ? words : null;
}

const inFlight = new Map<string, Promise<PageWordsMap>>();
/** Words made this session, for a reader that isn't cached on the device (the /readers/:id page). */
const madeThisSession: PageWordsMap = new Map();

/** Words made for this page earlier in the session (null when none or stale). */
export function sessionPageWords(pageId: string, text: string): ReaderWord[] | null {
  const words = madeThisSession.get(pageId);
  return words && wordsMatchText(words, text) ? words : null;
}

/**
 * Ask the server for the words of one reader's pages that lack them (once at a
 * time per reader). Resolves to the pages it made; an empty map offline or on
 * failure (the page simply stays plain text).
 */
export function requestReaderWords(readerId: string): Promise<PageWordsMap> {
  const running = inFlight.get(readerId);
  if (running) return running;
  const work = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return new Map() as PageWordsMap;
    try {
      const res = await backfillReaderWords({ reader_id: readerId });
      for (const p of res.pages) madeThisSession.set(p.id, p.words);
      const mine = res.pages.filter((p) => p.reader_id === readerId);
      await storeLocalPageWords(res.pages).catch(() => {});
      return new Map(mine.map((p) => [p.id, p.words])) as PageWordsMap;
    } catch {
      return new Map() as PageWordsMap;
    } finally {
      setTimeout(() => inFlight.delete(readerId), 0);
    }
  })();
  inFlight.set(readerId, work);
  return work;
}

const BACKFILL_KEY = 'reader-words-backfill-done-at';
const BACKFILL_IDLE_MS = 60 * 60 * 1000;

/**
 * Part of every sync: a few calls' worth of pages without words (newest
 * readers first). Once the server says none remain, it rests for an hour.
 */
export async function backfillReaderWordsInSync(maxCalls = 2): Promise<void> {
  try {
    const last = Number(localStorage.getItem(BACKFILL_KEY) || 0);
    if (last && Date.now() - last < BACKFILL_IDLE_MS) return;
  } catch {
    // storage blocked: just run
  }
  for (let i = 0; i < maxCalls; i++) {
    const res = await backfillReaderWords({});
    await storeLocalPageWords(res.pages);
    if (res.remaining <= 0 || res.pages.length === 0) {
      try {
        localStorage.setItem(BACKFILL_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      return;
    }
  }
}

const explainKey = (word: string, sentence: string) => `reader-word:${word}|${sentence}`;

/** The cached explanation, if this device has one. */
export async function cachedWordExplanation(word: string, sentence: string): Promise<ReaderWordExplanation | null> {
  const row = await db.sentenceTextExplanations.get(explainKey(word, sentence)).catch(() => undefined);
  if (!row) return null;
  try {
    return JSON.parse(row.explanation) as ReaderWordExplanation;
  } catch {
    return null;
  }
}

/** Cache-first explanation of a word in its sentence (Haiku on the server when not cached). */
export async function getWordExplanation(input: { word: string; sentence: string; pinyin?: string; gloss?: string }): Promise<ReaderWordExplanation> {
  const cached = await cachedWordExplanation(input.word, input.sentence);
  if (cached) return cached;
  const fresh = await explainReaderWord(input);
  await db.sentenceTextExplanations
    .put({ key: explainKey(input.word, input.sentence), explanation: JSON.stringify(fresh), cached_at: Date.now() })
    .catch(() => {});
  return fresh;
}

let knownCache: { at: number; set: Set<string> } | null = null;

/** Every hanzi in my decks (a word already there gets a subtle mark). Cached for a minute. */
export async function knownHanzi(): Promise<Set<string>> {
  if (knownCache && Date.now() - knownCache.at < 60_000) return knownCache.set;
  const set = new Set<string>();
  try {
    await db.notes.each((n) => {
      if (n.hanzi) set.add(n.hanzi.trim());
    });
  } catch {
    // no notes table yet
  }
  knownCache = { at: Date.now(), set };
  return set;
}

/** Forget the known-words cache (after a card was added). */
export function invalidateKnownHanzi(): void {
  knownCache = null;
}
