/**
 * Listening mode on this device (docs/CHAT.md "Listening mode"):
 *  - the setting per conversation + the account default, mirrored in
 *    localStorage so the chat renders hidden bubbles offline, synced with
 *    `GET /api/me/chat-listening` / `PUT …/listening` (a change made offline
 *    is kept `dirty` and re-sent on the next refresh);
 *  - revealed message ids per conversation (this device only);
 *  - the message clips: the Read-aloud clip (shared/chats/voice.ts, cached by
 *    text + voice + speed), prefetched on chat open, on live updates and in sync.
 *
 * The rules (what hides, which clips to prefetch) are shared/chats/listening.ts.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  addRevealed,
  effectiveListening,
  LISTENING_PREFETCH_COUNT,
  prefetchSelection,
  type ListeningMessage,
  type ListeningSetting,
} from '@shared/chats/listening';
import { getChatClips, getChatListening, putChatListeningDefault, putConversationListening } from '../api/chat';
import { isAudioCached } from './audioCache';
import { getTTSWithCache, ttsCacheKey } from './ttsCache';

// ---------- The setting ----------

interface StoredRow {
  on: boolean;
  since: string | null;
  updated_at: string;
  /** Changed on this device and not yet accepted by the server. */
  dirty?: boolean;
}

interface Stored {
  default_on: boolean;
  default_dirty?: boolean;
  conversations: Record<string, StoredRow>;
}

const KEY = 'chat-listening-v1';
const EMPTY: Stored = { default_on: false, conversations: {} };
const listeners = new Set<() => void>();
let snapshot: Stored | null = null;

function read(): Stored {
  if (snapshot) return snapshot;
  try {
    const raw = localStorage.getItem(KEY);
    snapshot = raw ? { ...EMPTY, ...(JSON.parse(raw) as Stored) } : EMPTY;
  } catch {
    snapshot = EMPTY;
  }
  return snapshot;
}

function write(next: Stored): void {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — memory still has it */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tests: forget the in-memory copy. */
export function resetChatListeningForTests(): void {
  snapshot = null;
}

export function listeningRow(conversationId: string | undefined): StoredRow | null {
  if (!conversationId) return null;
  return read().conversations[conversationId] ?? null;
}

export function listeningDefault(): boolean {
  return read().default_on;
}

/** The setting in force for a conversation (row, else the default, undecided). */
export function listeningFor(conversationId: string | undefined): ListeningSetting {
  return effectiveListening(listeningRow(conversationId), listeningDefault());
}

/** Re-renders when the setting changes (this tab or a refresh). */
export function useChatListening(conversationId: string | undefined): { setting: ListeningSetting; decided: boolean; defaultOn: boolean } {
  const state = useSyncExternalStore(subscribe, read, read);
  const row = conversationId ? state.conversations[conversationId] ?? null : null;
  return { setting: effectiveListening(row, state.default_on), decided: !!row, defaultOn: state.default_on };
}

/** Every conversation's setting (the inbox). */
export function useAllChatListening(): Stored {
  return useSyncExternalStore(subscribe, read, read);
}

/** Change one conversation's setting: on this device at once, then on the server (kept dirty until accepted). */
export async function setConversationListening(conversationId: string, on: boolean, since: string | null): Promise<void> {
  const cur = read();
  write({ ...cur, conversations: { ...cur.conversations, [conversationId]: { on, since, updated_at: new Date().toISOString(), dirty: true } } });
  try {
    const row = await putConversationListening(conversationId, on, since);
    const now = read();
    const local = now.conversations[conversationId];
    // A newer local change made meanwhile stays dirty.
    if (local && local.on === row.on && local.since === row.since) {
      write({ ...now, conversations: { ...now.conversations, [conversationId]: { on: row.on, since: row.since, updated_at: row.updated_at } } });
    }
  } catch (err) {
    console.warn('[chat-listening] saving the setting failed; kept on this device', err);
  }
}

/** Settings → Chat → "Listening mode in new chats". */
export async function setListeningDefault(on: boolean): Promise<void> {
  write({ ...read(), default_on: on, default_dirty: true });
  try {
    const res = await putChatListeningDefault(on);
    if (read().default_on === res.default_on) write({ ...read(), default_dirty: false });
  } catch (err) {
    console.warn('[chat-listening] saving the default failed; kept on this device', err);
  }
}

/** Pull the server's settings; re-send what this device changed offline. Never throws. */
export async function refreshChatListening(): Promise<void> {
  try {
    const cur = read();
    const res = await getChatListening();
    const conversations: Record<string, StoredRow> = {};
    for (const r of res.conversations) conversations[r.conversation_id] = { on: r.on, since: r.since, updated_at: r.updated_at };
    const resend: Array<[string, StoredRow]> = [];
    for (const [id, row] of Object.entries(cur.conversations)) {
      if (row.dirty) {
        conversations[id] = row;
        resend.push([id, row]);
      }
    }
    const defaultOn = cur.default_dirty ? cur.default_on : res.default_on;
    write({ default_on: defaultOn, default_dirty: cur.default_dirty, conversations });
    for (const [id, row] of resend) await setConversationListening(id, row.on, row.since);
    if (cur.default_dirty) await setListeningDefault(cur.default_on);
  } catch (err) {
    console.warn('[chat-listening] refresh failed', err);
  }
}

// ---------- Revealed ids (this device) ----------

const REVEALED_PREFIX = 'chat-listening-revealed-v1:';
const revealedMemo = new Map<string, string[]>();

export function loadRevealed(conversationId: string | undefined): string[] {
  if (!conversationId) return [];
  const memo = revealedMemo.get(conversationId);
  if (memo) return memo;
  let ids: string[] = [];
  try {
    const raw = localStorage.getItem(REVEALED_PREFIX + conversationId);
    ids = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    ids = [];
  }
  revealedMemo.set(conversationId, ids);
  return ids;
}

export function revealMessage(conversationId: string, messageId: string): string[] {
  const next = addRevealed(loadRevealed(conversationId), messageId);
  revealedMemo.set(conversationId, next);
  try {
    localStorage.setItem(REVEALED_PREFIX + conversationId, JSON.stringify(next));
  } catch {
    /* memory still has it */
  }
  for (const l of listeners) l();
  return next;
}

/** The revealed ids of a conversation as a Set, re-rendering when one is revealed. */
export function useRevealed(conversationId: string | undefined): Set<string> {
  const [ids, setIds] = useState(() => new Set(loadRevealed(conversationId)));
  useEffect(() => {
    setIds(new Set(loadRevealed(conversationId)));
    return subscribe(() => setIds(new Set(loadRevealed(conversationId))));
  }, [conversationId]);
  return ids;
}

// ---------- Slow playback ----------

const SLOW_KEY = 'chat-listening-slow';

export function loadSlowPlayback(): boolean {
  try {
    return localStorage.getItem(SLOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSlowPlayback(on: boolean): void {
  try {
    localStorage.setItem(SLOW_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ---------- Clips ----------
// The one chat TTS path (shared/chats/voice.ts): a message plays in the voice
// Read aloud uses, cache-first by (text, voice, speed) — `getTTSWithCache`.

export interface ReadAloudParams {
  voice: string;
  speed: number;
}

/** The clip for a message's text in that voice: the device cache, else the network. Offline and never fetched → null. */
export function getMessageClip(text: string, params: ReadAloudParams): Promise<Blob | null> {
  return getTTSWithCache(text, params.speed, params.voice);
}

async function fetchMissing(items: Array<{ text: string } & ReadAloudParams>): Promise<number> {
  let fetched = 0;
  for (const m of items) {
    if (await isAudioCached(ttsCacheKey(m.text, m.speed, m.voice)).catch(() => false)) continue;
    if (await getMessageClip(m.text, m).catch(() => null)) fetched++;
  }
  return fetched;
}

/** The fields of a chat message the listening rules read. */
export interface ChatMessageLike {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
  attachment?: { kind: string } | null;
}

export function toListeningMessage(m: ChatMessageLike): ListeningMessage {
  return { id: m.id, sender_id: m.sender_id, content: m.content, created_at: m.created_at, deleted_at: m.deleted_at ?? null, attachment_kind: m.attachment?.kind ?? null };
}

/**
 * Prefetch the clips a tap would play in this chat: the other person's Chinese
 * text messages, newest first, in the voice each is read in.
 */
export function prefetchMessageClips<T extends ChatMessageLike>(
  messages: readonly T[],
  myId: string,
  paramsFor: (m: T) => ReadAloudParams,
  limit = LISTENING_PREFETCH_COUNT,
): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve(0);
  const picked = prefetchSelection(messages.map(toListeningMessage), myId, limit);
  const byId = new Map(messages.map((m) => [m.id, m]));
  return fetchMissing(picked.map((p) => {
    const m = byId.get(p.id)!;
    return { text: m.content, ...paramsFor(m) };
  }));
}

/** Background sync: the newest messages of every chat with a person, in the voice I hear them (server-computed). Never throws. */
export async function prefetchChatClipsInSync(): Promise<number> {
  try {
    const { clips } = await getChatClips();
    return await fetchMissing(clips.map((c) => ({ text: c.text, voice: c.voice_id, speed: c.speed })));
  } catch (err) {
    console.warn('[chat-listening] clip prefetch failed', err);
    return 0;
  }
}

let liveHooked = false;
let liveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * While the live socket is open (a chat or the inbox on screen): a new message
 * from the other person → prefetch (a few seconds later, once the server has
 * pre-generated the clip). Idempotent.
 */
export function prefetchClipsFromLiveEvents(myId: () => string | null): void {
  if (liveHooked) return;
  liveHooked = true;
  void import('./chatLive').then(({ chatLive }) => {
    chatLive.onEvent((e) => {
      if (e.type !== 'message' && e.type !== 'message_updated') return;
      const me = myId();
      if (!me || e.message.sender_id === me) return;
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = setTimeout(() => void prefetchChatClipsInSync(), 4000);
    });
  });
}
