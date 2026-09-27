import Dexie, { type Table } from 'dexie';
import { parseCharStrokeData, strokeDataFile, type CharStrokeData } from '@shared/strokes';

/**
 * Stroke-order data for handwriting practice, offline-first.
 *
 * Source: hanzi-writer-data (Make Me a Hanzi, Arphic Public License), served
 * by our own Pages deploy at /strokes/<hex>.json (see strokeDataPlugin in
 * vite.config.ts). Each character is ~2 KB; once fetched it lives in its own
 * small IndexedDB database — deliberately separate from the main
 * ChineseLearningDB so it needs no schema bump and never bloats backups.
 */

interface StoredChar {
  char: string;
  data: CharStrokeData;
  fetched_at: number;
}

interface MissingChar {
  char: string;
  checked_at: number;
}

class StrokeDataDB extends Dexie {
  chars!: Table<StoredChar, string>;
  missing!: Table<MissingChar, string>;
  constructor() {
    super('stroke-data');
    this.version(1).stores({ chars: 'char', missing: 'char' });
  }
}

let db: StrokeDataDB | null = null;
function getDb(): StrokeDataDB | null {
  if (db) return db;
  try {
    db = new StrokeDataDB();
    return db;
  } catch {
    return null;
  }
}

const memory = new Map<string, CharStrokeData>();
/** Don't re-ask the network for a character we know isn't in the dataset for a week. */
const MISSING_TTL_MS = 7 * 24 * 3600 * 1000;

export type StrokeDataResult =
  | { status: 'ok'; data: CharStrokeData }
  /** The dataset has no entry for this character (rare / not a CJK ideograph). */
  | { status: 'missing' }
  /** Not cached and the network failed — try again when online. */
  | { status: 'offline' };

const STROKES_BASE = '/strokes/';

async function fetchFromNetwork(char: string): Promise<StrokeDataResult> {
  let res: Response;
  try {
    res = await fetch(STROKES_BASE + strokeDataFile(char));
  } catch {
    return { status: 'offline' };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'offline' };
  // Pages answers unknown paths with the SPA's index.html (200, text/html).
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) return { status: 'missing' };
  try {
    const data = parseCharStrokeData(await res.json());
    return data ? { status: 'ok', data } : { status: 'missing' };
  } catch {
    return { status: 'missing' };
  }
}

/** One character's data: memory → IndexedDB → network (and cache it). */
export async function getStrokeData(char: string): Promise<StrokeDataResult> {
  const hit = memory.get(char);
  if (hit) return { status: 'ok', data: hit };
  const store = getDb();
  if (store) {
    try {
      const row = await store.chars.get(char);
      if (row) {
        memory.set(char, row.data);
        return { status: 'ok', data: row.data };
      }
      const miss = await store.missing.get(char);
      if (miss && Date.now() - miss.checked_at < MISSING_TTL_MS) return { status: 'missing' };
    } catch {
      // IndexedDB unavailable (private mode…) — fall through to the network
    }
  }
  const result = await fetchFromNetwork(char);
  if (store) {
    try {
      if (result.status === 'ok') {
        await store.chars.put({ char, data: result.data, fetched_at: Date.now() });
        await store.missing.delete(char);
      } else if (result.status === 'missing') {
        await store.missing.put({ char, checked_at: Date.now() });
      }
    } catch {
      // caching is best-effort
    }
  }
  if (result.status === 'ok') memory.set(char, result.data);
  return result;
}

/** Characters of `chars` already stored on this device. */
export async function cachedCharacters(chars: string[]): Promise<Set<string>> {
  const store = getDb();
  const out = new Set<string>();
  for (const c of chars) if (memory.has(c)) out.add(c);
  if (!store) return out;
  try {
    const rows = await store.chars.bulkGet(chars);
    rows.forEach((r) => {
      if (r) out.add(r.char);
    });
  } catch {
    // ignore
  }
  return out;
}

/**
 * Download every character in `chars` that isn't on the device yet, a few at a
 * time. Reports progress; stops early (returning what it got) when offline.
 */
export async function prefetchStrokeData(
  chars: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; missing: number; failed: number }> {
  const unique = Array.from(new Set(chars));
  const have = await cachedCharacters(unique);
  const todo = unique.filter((c) => !have.has(c));
  let done = 0;
  let saved = 0;
  let missing = 0;
  let failed = 0;
  onProgress?.(0, todo.length);
  const CONCURRENCY = 6;
  let next = 0;
  let offlineStreak = 0;
  const worker = async () => {
    while (next < todo.length && offlineStreak < 5) {
      const c = todo[next++];
      const r = await getStrokeData(c);
      if (r.status === 'ok') {
        saved++;
        offlineStreak = 0;
      } else if (r.status === 'missing') missing++;
      else {
        failed++;
        offlineStreak++;
      }
      done++;
      onProgress?.(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { saved, missing, failed };
}
