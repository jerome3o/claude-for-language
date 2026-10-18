/**
 * 梗 Meme review on the device (prototype, docs/MEME_REVIEW.md). An opened issue is kept in its
 * OWN small IndexedDB database (`meme-review` — separate from ChineseLearningDB, so the prototype
 * needs no schema bump and the study sync never sees it): the issue's text, its pictures (our own
 * illustrations, fetched as blobs) and, via practice TTS, its audio. Links to the original videos
 * and posts need a connection.
 */
import Dexie, { type Table } from 'dexie';
import { memeAudioLines, type MemeIssue, type MemeIssueRecord, type MemeIssueSummary } from '@shared/meme-review';
import { getAudioUrl } from '../api/client';
import { getMemeIssue, listMemeIssues, type MemeIssueList } from '../api/memeReview';
import { prefetchTTSClips } from './ttsCache';

interface StoredIssue {
  month: string;
  record: MemeIssueRecord;
  cached_at: number;
}

interface StoredPicture {
  key: string;
  blob: Blob;
}

interface StoredList {
  id: 'list';
  list: MemeIssueList;
}

class MemeReviewDB extends Dexie {
  issues!: Table<StoredIssue, string>;
  pictures!: Table<StoredPicture, string>;
  lists!: Table<StoredList, string>;
  constructor() {
    super('meme-review');
    this.version(1).stores({ issues: 'month', pictures: 'key', lists: 'id' });
  }
}

let db: MemeReviewDB | null = null;
function getDb(): MemeReviewDB | null {
  if (db) return db;
  try {
    db = new MemeReviewDB();
    return db;
  } catch {
    return null;
  }
}

export async function cachedMemeIssue(month: string): Promise<MemeIssueRecord | null> {
  const row = await getDb()?.issues.get(month).catch(() => undefined);
  return row?.record ?? null;
}

/** Months on this device (a list row shows ✓). */
export async function cachedMemeMonths(): Promise<Set<string>> {
  const rows = (await getDb()?.issues.toArray().catch(() => [])) ?? [];
  return new Set(rows.filter((r) => r.record.status === 'ready').map((r) => r.month));
}

async function cachePictures(issue: MemeIssue): Promise<void> {
  const store = getDb();
  if (!store || !navigator.onLine) return;
  for (const item of issue.items) {
    const key = item.picture.image_key;
    if (!key || (await store.pictures.get(key).catch(() => undefined))) continue;
    try {
      const res = await fetch(getAudioUrl(key));
      if (res.ok) await store.pictures.put({ key, blob: await res.blob() });
    } catch {
      /* next time */
    }
  }
}

async function storeIssue(record: MemeIssueRecord): Promise<void> {
  if (record.status !== 'ready' || !record.issue) return;
  await getDb()?.issues.put({ month: record.month, record, cached_at: Date.now() }).catch(() => undefined);
  void cachePictures(record.issue);
}

/** The server's issue (stored when ready) + the lesson job of this account. Throws offline. */
export async function fetchMemeIssue(month: string) {
  const res = await getMemeIssue(month);
  await storeIssue(res.issue);
  return res;
}

/** The list right away from this device, else null. */
export async function cachedMemeList(): Promise<MemeIssueList | null> {
  const row = await getDb()?.lists.get('list').catch(() => undefined);
  return row?.list ?? null;
}

export async function refreshMemeList(): Promise<MemeIssueList> {
  const list = await listMemeIssues();
  await getDb()?.lists.put({ id: 'list', list }).catch(() => undefined);
  return list;
}

/** Offline list: the issues opened on this device. */
export async function offlineMemeSummaries(): Promise<MemeIssueSummary[]> {
  const rows = (await getDb()?.issues.toArray().catch(() => [])) ?? [];
  return rows
    .filter((r) => r.record.issue)
    .map((r) => ({
      month: r.month,
      status: 'ready' as const,
      title: r.record.issue!.title,
      title_en: r.record.issue!.title_en,
      item_count: r.record.issue!.items.length,
      preview: r.record.issue!.items.slice(0, 4).map((i) => i.hanzi),
      updated_at: r.record.updated_at,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

const objectUrls = new Map<string, string>();

/** A picture: the cached blob (offline), else the public URL. */
export async function memePictureUrl(key: string): Promise<string> {
  const hit = objectUrls.get(key);
  if (hit) return hit;
  const row = await getDb()?.pictures.get(key).catch(() => undefined);
  if (row?.blob && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(row.blob);
    objectUrls.set(key, url);
    return url;
  }
  return getAudioUrl(key);
}

/** Every ▶ line of the issue, generated + cached one by one in the background. */
export function prefetchMemeAudio(issue: MemeIssue): void {
  if (!navigator.onLine) return;
  void prefetchTTSClips(memeAudioLines(issue).map((text) => ({ text }))).catch(() => undefined);
}
