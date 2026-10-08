/**
 * 成语 Idioms on the device (docs/IDIOMS.md). Entries are global on the server (one per idiom)
 * and cached here once opened (IndexedDB `idioms`), so a page opened before reads offline —
 * its narration too, once played or prefetched (practice TTS, cached per text). The list is
 * the server's (starter + looked up) when online, else the shipped starter list + what this
 * device has opened.
 */
import { STARTER_IDIOMS, type IdiomEntry, type IdiomRecord, type IdiomSummary } from '@shared/idioms';
import { db } from '../db/database';
import { getIdiom, listIdioms, requestIdiom } from '../api/idioms';
import { prefetchTTSClips } from './ttsCache';

const LIST_KEY = 'idioms-list-v1';

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export async function cachedIdiom(hanzi: string): Promise<IdiomRecord | null> {
  const row = await db.idioms.get(hanzi).catch(() => undefined);
  return row?.record ?? null;
}

/** Entries opened on this device, most recent first. */
export async function cachedIdioms(): Promise<IdiomRecord[]> {
  const rows = await db.idioms.orderBy('opened_at').reverse().toArray().catch(() => []);
  return rows.map((r) => r.record).filter((r) => r.status === 'ready');
}

/** Is there a ready entry for it on this device (the explorer's "📜 Story & usage" link)? */
export async function hasCachedIdiom(hanzi: string): Promise<boolean> {
  return (await cachedIdiom(hanzi))?.status === 'ready';
}

async function store(record: IdiomRecord): Promise<void> {
  if (record.status !== 'ready') return;
  const now = Date.now();
  await db.idioms.put({ hanzi: record.hanzi, record, cached_at: now, opened_at: now }).catch(() => undefined);
}

export async function markIdiomOpened(hanzi: string): Promise<void> {
  await db.idioms.update(hanzi, { opened_at: Date.now() }).catch(() => 0);
}

/** The server's row (stored when ready). Throws when offline / failing. */
export async function fetchIdiom(hanzi: string): Promise<IdiomRecord> {
  const { idiom } = await getIdiom(hanzi);
  await store(idiom);
  return idiom;
}

/** Get-or-generate on the server. */
export async function startIdiom(hanzi: string, retry = false): Promise<IdiomRecord> {
  const { idiom } = await requestIdiom(hanzi, retry);
  await store(idiom);
  return idiom;
}

function readListCache(): { starter: IdiomSummary[]; more: IdiomSummary[] } | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The list right away: the last server list on this device, else the shipped starter list. */
export async function localIdiomList(): Promise<{ starter: IdiomSummary[]; more: IdiomSummary[] }> {
  const cached = readListCache();
  const opened = await cachedIdioms();
  const openedSet = new Set(opened.map((r) => r.hanzi));
  const starter: IdiomSummary[] = (cached?.starter ?? STARTER_IDIOMS.map((s) => ({ hanzi: s.hanzi, pinyin: s.pinyin, english: s.english, status: 'missing' as const, starter: true })))
    .map((s) => (openedSet.has(s.hanzi) ? { ...s, status: 'ready' as const } : s));
  const more = [...(cached?.more ?? [])];
  for (const r of opened) {
    if (!r.entry || starter.some((s) => s.hanzi === r.hanzi) || more.some((m) => m.hanzi === r.hanzi)) continue;
    more.unshift({ hanzi: r.hanzi, pinyin: r.entry.pinyin, english: r.entry.meaning, status: 'ready', starter: false });
  }
  return { starter, more };
}

/** The server list (cached for next time). */
export async function refreshIdiomList(): Promise<{ starter: IdiomSummary[]; more: IdiomSummary[] }> {
  const list = await listIdioms();
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* storage full / blocked: the list is still shown */
  }
  return list;
}

/** Narration for offline: the headword and the story, fetched one by one in the background. */
export function prefetchIdiomAudio(entry: IdiomEntry): void {
  if (!isOnline()) return;
  void prefetchTTSClips([{ text: entry.hanzi }, ...entry.origin.story.map((p) => ({ text: p.hanzi }))]).catch(() => undefined);
}
