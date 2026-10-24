/**
 * Practice per example sentence on this device (docs/STUDY_SESSION.md "Sentence practice history";
 * rules in shared/study/sentenceHistory.ts, Lab `data/sentences/SentencePracticeStore.kt`): every 🎤 take
 * on a sentence (the Sentence round, the answer side's rows) and every "Stop showing this sentence" /
 * "Show again" is an event, written here first (offline-first), uploaded to `POST /api/me/sentence-practice`
 * (idempotent by id) at once when online and in every sync, and the other devices' events come down after
 * a cursor. `useSentenceStats(noteId)` folds a note's events (`sentenceStats`) for the round's picks and the
 * hidden rows. Its own small IndexedDB, like the chat outbox.
 *
 * "✨ New sentences coming": a word whose sentences are all known (or fewer than four left) asks the
 * sentence top-up for more — once a day per word; offline the ask waits for the next sync.
 */
import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import {
  sentenceHistoryKey,
  sentenceStats,
  type SentenceHideReason,
  type SentencePracticeEvent,
  type SentencePracticeResult,
  type SentenceStats,
} from '@shared/study/sentenceHistory';
import type { SentencePractiseMode } from '@shared/study/sentencePractise';
import { API_BASE, getAuthHeaders, getLocalDateString } from '../api/client';
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

const TOPUP_KEY = 'sentence-round-topups-v1';
interface TopUpState { asked: Record<string, string>; pending: Record<string, 'known' | 'few'> }

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
    // Only today's asks are worth keeping.
    const today = getLocalDateString();
    const asked = Object.fromEntries(Object.entries(s.asked).filter(([, d]) => d === today));
    localStorage.setItem(TOPUP_KEY, JSON.stringify({ asked, pending: s.pending }));
  } catch {
    /* private mode: asked again next time */
  }
}

/** True when this word already asked for more sentences today (the note shows). */
export function sentencesComing(noteId: string): boolean {
  const s = readTopUps();
  return s.asked[noteId] === getLocalDateString() || !!s.pending[noteId];
}

async function postTopUp(noteIds: string[], reason: 'known' | 'few'): Promise<void> {
  await call('/sentences/top-up', { method: 'POST', body: JSON.stringify({ note_ids: noteIds, reason }) });
}

/** Ask for more sentences for this word (once a day); offline → at the next sync. */
export function requestMoreSentences(noteId: string, why: 'known' | 'few'): void {
  const s = readTopUps();
  const today = getLocalDateString();
  if (s.asked[noteId] === today || s.pending[noteId]) return;
  const online = typeof navigator === 'undefined' || navigator.onLine;
  if (online) {
    s.asked[noteId] = today;
    writeTopUps(s);
    track('study.sentence_topup_requested', { why, queued: true });
    postTopUp([noteId], why).catch(() => {
      const again = readTopUps();
      again.pending[noteId] = why;
      writeTopUps(again);
    });
  } else {
    s.pending[noteId] = why;
    writeTopUps(s);
    track('study.sentence_topup_requested', { why, queued: false });
  }
}

async function flushPendingTopUps(): Promise<void> {
  const s = readTopUps();
  const entries = Object.entries(s.pending);
  if (!entries.length) return;
  const today = getLocalDateString();
  for (const why of ['known', 'few'] as const) {
    const ids = entries.filter(([, w]) => w === why).map(([id]) => id);
    if (!ids.length) continue;
    try {
      await postTopUp(ids.slice(0, 50), why);
      for (const id of ids.slice(0, 50)) {
        delete s.pending[id];
        s.asked[id] = today;
      }
    } catch {
      /* next sync */
    }
  }
  writeTopUps(s);
}

/** Tests: forget everything on this device. */
export async function resetSentencePracticeForTests(): Promise<void> {
  await db().events.clear();
  await db().meta.clear();
  try { localStorage.removeItem(TOPUP_KEY); } catch { /* */ }
}
