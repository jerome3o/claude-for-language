/**
 * Practice per example sentence on this device (docs/STUDY_SESSION.md "Sentence practice history";
 * rules in shared/study/sentenceHistory.ts, Lab `data/sentences/SentencePracticeStore.kt`): every 🎤 take
 * on a sentence (the Sentence round, the answer side's rows) and every "Stop showing this sentence" /
 * "Show again" is an event, written here first (offline-first), uploaded to `POST /api/me/sentence-practice`
 * (idempotent by id) at once when online and in every sync, and the other devices' events come down after
 * a cursor. `useSentenceStats(noteId)` folds a note's events (`sentenceStats`) for the round's picks and the
 * hidden rows. Its own small IndexedDB, like the chat outbox.
 *
 * Fresh sentences: the Sentence round asks sentences he has never practised first and keeps a buffer of
 * them (`moreSentencesWanted`) — fewer than six fresh (or four left) asks the sentence top-up for more, at
 * most every ten minutes per word; the rows + clips are pulled a little later; offline the ask waits for the
 * next sync. "✨ New sentences coming" only when the round itself is short (`sentencesComingShown`).
 */
import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import {
  SENTENCE_TOPUP_RETRY_MS,
  sentenceHistoryKey,
  sentenceStats,
  type MoreSentencesReason,
  type SentenceHideReason,
  type SentencePracticeEvent,
  type SentencePracticeResult,
  type SentenceStats,
} from '@shared/study/sentenceHistory';
import type { SentencePractiseMode } from '@shared/study/sentencePractise';
import { API_BASE, getAuthHeaders } from '../api/client';
import { track } from './analytics';

interface LocalEvent extends SentencePracticeEvent {
  /** 0 = waiting to upload, 1 = on the server, -1 = refused (not the account's note). */
  _synced: number;
}

class SentencePracticeDb extends Dexie {
  events!: Table<LocalEvent, string>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor() {
    super('sentence-practice');
    this.version(1).stores({ events: 'id, note_id, _synced', meta: 'key' });
  }
}

let dbInstance: SentencePracticeDb | null = null;
function db(): SentencePracticeDb {
  if (!dbInstance) dbInstance = new SentencePracticeDb();
  return dbInstance;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function addEvent(e: Omit<SentencePracticeEvent, 'id' | 'at'>): Promise<SentencePracticeEvent> {
  const event: LocalEvent = { ...e, id: newId(), at: new Date().toISOString(), _synced: 0 };
  try {
    await db().events.put(event);
  } catch (err) {
    console.warn('[sentence-practice] could not store the event', err);
  }
  if (typeof navigator === 'undefined' || navigator.onLine) void uploadPendingSentencePractice().catch(() => {});
  const { _synced: _, ...plain } = event;
  return plain;
}

/** A 🎤 take on a sentence was judged (round or row). `rowKey` = the list's row key (`clue:<noteId>` or the set id). */
export function recordSentenceAttempt(noteId: string, rowKey: string, mode: SentencePractiseMode, result: SentencePracticeResult): void {
  void addEvent({ note_id: noteId, sentence_key: sentenceHistoryKey(rowKey), kind: 'attempt', mode, result, reason: null });
}

/** "Stop showing this sentence". Returns the event (Undo = `unhideSentence`). */
export function hideSentence(noteId: string, rowKey: string, reason: SentenceHideReason, where: 'round' | 'list'): Promise<SentencePracticeEvent> {
  track('study.sentence_hidden', { reason, where, unhidden: false });
  return addEvent({ note_id: noteId, sentence_key: sentenceHistoryKey(rowKey), kind: 'hide', mode: null, result: null, reason });
}

/** "Show again" / Undo. */
export function unhideSentence(noteId: string, rowKey: string, where: 'round' | 'list'): Promise<SentencePracticeEvent> {
  track('study.sentence_hidden', { where, unhidden: true });
  return addEvent({ note_id: noteId, sentence_key: sentenceHistoryKey(rowKey), kind: 'unhide', mode: null, result: null, reason: null });
}

/** The note's stats per sentence key (live; null while loading; empty without IndexedDB). */
export function useSentenceStats(noteId: string): Map<string, SentenceStats> | null {
  const events = useLiveQuery(async () => {
    try {
      return await db().events.where('note_id').equals(noteId).toArray();
    } catch {
      return [];
    }
  }, [noteId]);
  return useMemo(() => (events ? sentenceStats(events, noteId) : null), [events, noteId]);
}

let uploading: Promise<void> | null = null;

/** Upload this device's waiting events (in sync, and at once after each one when online). */
export function uploadPendingSentencePractice(): Promise<void> {
  if (uploading) return uploading;
  uploading = (async () => {
    try {
      for (let round = 0; round < 20; round++) {
        const pending = await db().events.where('_synced').equals(0).limit(200).toArray();
        if (pending.length === 0) return;
        const res = await call<{ accepted: string[]; rejected: string[] }>('/me/sentence-practice', {
          method: 'POST',
          body: JSON.stringify({ events: pending.map(({ _synced: _, ...e }) => e) }),
        });
        await db().transaction('rw', db().events, async () => {
          for (const id of res.accepted ?? []) await db().events.update(id, { _synced: 1 });
          for (const id of res.rejected ?? []) await db().events.update(id, { _synced: -1 });
        });
        if (!res.accepted?.length && !res.rejected?.length) return;
      }
    } finally {
      uploading = null;
    }
  })();
  return uploading;
}

const CURSOR_KEY = 'cursor';

/** Sync: upload, then every device's events received since the last time. */
export async function syncSentencePractice(): Promise<void> {
  await uploadPendingSentencePractice();
  let cursor = (await db().meta.get(CURSOR_KEY))?.value ?? null;
  for (let page = 0; page < 20; page++) {
    const q = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
    const res = await call<{ events: SentencePracticeEvent[]; cursor: string | null; more: boolean }>(`/me/sentence-practice${q}`);
    if (res.events.length) {
      await db().events.bulkPut(res.events.map((e) => ({
        id: e.id, note_id: e.note_id, sentence_key: e.sentence_key, kind: e.kind, mode: e.mode ?? null,
        result: e.result ?? null, reason: e.reason ?? null, at: e.at, _synced: 1,
      })));
    }
    if (res.cursor) {
      cursor = res.cursor;
      await db().meta.put({ key: CURSOR_KEY, value: cursor });
    }
    if (!res.more) break;
  }
  await flushPendingTopUps();
}

// --- "✨ New sentences coming for this word" ---------------------------------------------------

const TOPUP_KEY = 'sentence-round-topups-v2';
type TopUpWant = { reason: MoreSentencesReason; count: number };
/** asked = when each word last asked (ISO); pending = asks made offline / that failed, sent with the next sync. */
interface TopUpState { asked: Record<string, string>; pending: Record<string, TopUpWant> }

function readTopUps(): TopUpState {
  try {
    const raw = localStorage.getItem(TOPUP_KEY);
    const s = raw ? (JSON.parse(raw) as TopUpState) : null;
    return { asked: s?.asked ?? {}, pending: s?.pending ?? {} };
  } catch {
    return { asked: {}, pending: {} };
  }
}
function writeTopUps(s: TopUpState): void {
  try {
    // Only recent asks are worth keeping.
    const cutoff = Date.now() - SENTENCE_TOPUP_RETRY_MS;
    const asked = Object.fromEntries(Object.entries(s.asked).filter(([, at]) => Date.parse(at) > cutoff));
    localStorage.setItem(TOPUP_KEY, JSON.stringify({ asked, pending: s.pending }));
  } catch {
    /* private mode: asked again next time */
  }
}

function askedRecently(s: TopUpState, noteId: string, now = Date.now()): boolean {
  const at = s.asked[noteId];
  return !!at && now - Date.parse(at) < SENTENCE_TOPUP_RETRY_MS;
}

async function postTopUp(noteIds: string[], reason: MoreSentencesReason, counts: Record<string, number>): Promise<void> {
  await call('/sentences/top-up', { method: 'POST', body: JSON.stringify({ note_ids: noteIds, reason, counts }) });
}

/**
 * The new rows come down with the next sentence sync; pull them a little after the ask instead (the
 * server writes them in well under a minute) and download their clips, so the round's buffer plays
 * offline. Best-effort.
 */
function pullNewSentencesSoon(noteIds: string[]): void {
  for (const delay of [45_000, 150_000]) {
    setTimeout(() => {
      void import('./sentence-sets')
        .then(async (m) => {
          await m.syncSentenceSets();
          for (const id of noteIds) m.cacheSentenceAudio(await m.getLocalNoteSentences(id));
        })
        .catch(() => { /* the next sync */ });
    }, delay);
  }
}

/**
 * Ask for more sentences for this word (`moreSentencesWanted`: its fresh buffer is low, or too few are
 * left): at most once per SENTENCE_TOPUP_RETRY_MS; offline → at the next sync.
 */
export function requestMoreSentences(noteId: string, want: TopUpWant): void {
  const s = readTopUps();
  if (askedRecently(s, noteId) || s.pending[noteId]) return;
  const online = typeof navigator === 'undefined' || navigator.onLine;
  if (online) {
    s.asked[noteId] = new Date().toISOString();
    writeTopUps(s);
    track('study.sentence_topup_requested', { why: want.reason, count: want.count, queued: true });
    postTopUp([noteId], want.reason, { [noteId]: want.count })
      .then(() => pullNewSentencesSoon([noteId]))
      .catch(() => {
        const again = readTopUps();
        again.pending[noteId] = want;
        writeTopUps(again);
      });
  } else {
    s.pending[noteId] = want;
    writeTopUps(s);
    track('study.sentence_topup_requested', { why: want.reason, count: want.count, queued: false });
  }
}

async function flushPendingTopUps(): Promise<void> {
  const s = readTopUps();
  const entries = Object.entries(s.pending);
  if (!entries.length) return;
  const now = new Date().toISOString();
  for (const reason of ['few', 'fresh'] as const) {
    const batch = entries.filter(([, w]) => w?.reason === reason).slice(0, 50);
    if (!batch.length) continue;
    try {
      await postTopUp(batch.map(([id]) => id), reason, Object.fromEntries(batch.map(([id, w]) => [id, w.count])));
      for (const [id] of batch) {
        delete s.pending[id];
        s.asked[id] = now;
      }
      pullNewSentencesSoon(batch.map(([id]) => id));
    } catch {
      /* next sync */
    }
  }
  // Anything else (an older shape) is dropped: the round asks again when it opens.
  for (const [id, w] of entries) if (w?.reason !== 'few' && w?.reason !== 'fresh') delete s.pending[id];
  writeTopUps(s);
}

/** Tests: forget everything on this device. */
export async function resetSentencePracticeForTests(): Promise<void> {
  await db().events.clear();
  await db().meta.clear();
  try { localStorage.removeItem(TOPUP_KEY); } catch { /* */ }
}
