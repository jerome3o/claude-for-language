/**
 * The word dictionary on the device (docs/LANGUAGE_EXPLORER.md; GET /api/words). Like the
 * character dictionary (services/charDict.ts): cache-first, one IndexedDB row per word the
 * learner has explored, batched lookups, a word the dictionary lacks asked about again after
 * a week. Offline and never looked up → `null`; the Word view then builds itself from the
 * character records and the learner's own cards.
 */
import { WORD_BATCH_MAX, WORD_DICT_VERSION, type WordRecord } from '@shared/chars/types';
import { hanOnly } from '@shared/explorer';
import { fetchWordRecords } from '../api/client';
import { db } from '../db/database';

const MISSING_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export type WordLookup =
  | { status: 'ok'; record: WordRecord }
  | { status: 'missing' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

const isWord = (w: string) => w.length > 0 && hanOnly(w) === w && [...w].length >= 2 && [...w].length <= 6;

/** Records of `words` (device first, the rest in batches of WORD_BATCH_MAX). */
export async function lookupWords(words: readonly string[]): Promise<Map<string, WordLookup>> {
  const wanted = [...new Set(words.filter(isWord))];
  const out = new Map<string, WordLookup>();
  if (wanted.length === 0) return out;
  const rows = await db.wordDict.bulkGet(wanted).catch(() => wanted.map(() => undefined));
  const todo: string[] = [];
  wanted.forEach((w, i) => {
    const row = rows[i];
    if (row && row.version === WORD_DICT_VERSION) {
      if (row.record) return void out.set(w, { status: 'ok', record: row.record });
      if (Date.now() - row.cached_at < MISSING_RETRY_MS) return void out.set(w, { status: 'missing' });
    }
    todo.push(w);
  });
  if (todo.length === 0) return out;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    for (const w of todo) out.set(w, { status: 'offline' });
    return out;
  }
  for (let i = 0; i < todo.length; i += WORD_BATCH_MAX) {
    const batch = todo.slice(i, i + WORD_BATCH_MAX);
    try {
      const { records, missing } = await fetchWordRecords(batch);
      const now = Date.now();
      await db.wordDict
        .bulkPut([
          ...Object.values(records).map((record) => ({ hanzi: record.hanzi, record, version: WORD_DICT_VERSION, cached_at: now })),
          ...missing.map((hanzi) => ({ hanzi, record: null, version: WORD_DICT_VERSION, cached_at: now })),
        ])
        .catch(() => {});
      for (const w of batch) out.set(w, records[w] ? { status: 'ok', record: records[w] } : { status: 'missing' });
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      for (const w of batch) out.set(w, status === undefined ? { status: 'offline' } : { status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export async function lookupWord(hanzi: string): Promise<WordLookup> {
  return (await lookupWords([hanzi])).get(hanzi) ?? { status: 'missing' };
}
