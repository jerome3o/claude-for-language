/**
 * Listening mode in the chat (docs/CHAT.md "Listening mode"): the other
 * person's Chinese text messages arrive as a hidden bubble — tap plays it, a
 * long press reveals it — so each new message is a listening exercise first.
 *
 * Pure rules shared by both apps: the web (pages/ChatPage.tsx, ChatsPage.tsx,
 * services/chatListening.ts) and the Lab app (core `ChatListening.kt`,
 * parity-tested by android-lab/parity/fixtures/chat-listening.ts). The worker
 * uses `listeningCandidate` + `LISTENING_PREVIEW` for notification previews.
 */

/** What a notification / the inbox shows instead of a hidden message. */
export const LISTENING_PREVIEW = '🎧 New message';

/** "Hide all": every message of the other person hides (except revealed ones). */
export const HIDE_ALL_SINCE = '1970-01-01T00:00:00.000Z';

/** How many of a conversation's newest messages get their clip prefetched. */
export const LISTENING_PREFETCH_COUNT = 20;

/** Most revealed ids remembered per conversation (oldest dropped first). */
export const REVEALED_MAX = 500;

/**
 * One person's listening setting for one conversation. `since` = messages
 * created AFTER it hide; null = not decided yet (the mode came from the
 * Settings default and the chat hasn't been opened since): the client then
 * uses the read marker it opened the chat with, and stores it.
 */
export interface ListeningSetting {
  on: boolean;
  since: string | null;
}

export interface ListeningMessage {
  id: string;
  sender_id: string;
  content: string;
  /** ISO string. */
  created_at: string;
  deleted_at?: string | null;
  /** 'image' | 'voice' | 'file' | 'video' — anything with an attachment stays as is. */
  attachment_kind?: string | null;
}

export function hasHan(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

/** The setting in force: the conversation's own row, else the account default (not decided yet). */
export function effectiveListening(row: ListeningSetting | null | undefined, defaultOn: boolean): ListeningSetting {
  if (row) return { on: row.on, since: row.since };
  return { on: defaultOn, since: null };
}

/**
 * A message listening mode could hide: the other person's, not deleted, a
 * plain text message (photos, voice memos, files, videos stay as they are)
 * that contains Chinese.
 */
export function listeningCandidate(msg: ListeningMessage, viewerId: string): boolean {
  if (msg.sender_id === viewerId) return false;
  if (msg.deleted_at) return false;
  if (msg.attachment_kind) return false;
  return hasHan(msg.content);
}

/** Where hiding starts: the setting's own `since`, else the read marker the chat opened with ('' = everything). */
export function listeningThreshold(setting: ListeningSetting, readMarkerAtOpen: string | null | undefined): string {
  if (setting.since !== null) return setting.since;
  return readMarkerAtOpen ?? HIDE_ALL_SINCE;
}

export interface HideContext {
  viewerId: string;
  setting: ListeningSetting;
  /** My read marker when the chat was opened (only used while `since` is null). */
  readMarkerAtOpen?: string | null;
  /** Ids revealed on this device. */
  revealed: ReadonlySet<string> | readonly string[];
}

function isRevealed(revealed: HideContext['revealed'], id: string): boolean {
  return Array.isArray(revealed) ? revealed.includes(id) : (revealed as ReadonlySet<string>).has(id);
}

/** Is this message drawn as a hidden listening bubble? */
export function shouldHideMessage(msg: ListeningMessage, ctx: HideContext): boolean {
  if (!ctx.setting.on) return false;
  if (!listeningCandidate(msg, ctx.viewerId)) return false;
  if (isRevealed(ctx.revealed, msg.id)) return false;
  return msg.created_at > listeningThreshold(ctx.setting, ctx.readMarkerAtOpen);
}

/**
 * The `since` to store when the mode is switched ON from the menu: everything
 * already on screen stays visible, anything newer hides. Uses the newest
 * message time when there is one (server clock), else `nowIso`.
 */
export function sinceWhenTurnedOn(messages: readonly Pick<ListeningMessage, 'created_at'>[], nowIso: string): string {
  let newest = '';
  for (const m of messages) if (m.created_at > newest) newest = m.created_at;
  return newest || nowIso;
}

/** Revealed ids after revealing `id` (newest last, capped). */
export function addRevealed(revealed: readonly string[], id: string, max: number = REVEALED_MAX): string[] {
  const next = revealed.filter((x) => x !== id);
  next.push(id);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** The inbox / notification line for a conversation's newest message. */
export function listeningPreview(
  last: { id: string; sender_id: string; created_at: string; preview: string; attachment_kind?: string | null; deleted?: boolean } | null,
  ctx: { viewerId: string; setting: ListeningSetting; readMarker?: string | null; revealed: HideContext['revealed'] },
): string | null {
  if (!last) return null;
  const msg: ListeningMessage = {
    id: last.id,
    sender_id: last.sender_id,
    content: last.preview,
    created_at: last.created_at,
    deleted_at: last.deleted ? last.created_at : null,
    attachment_kind: last.attachment_kind ?? null,
  };
  return shouldHideMessage(msg, { viewerId: ctx.viewerId, setting: ctx.setting, readMarkerAtOpen: ctx.readMarker, revealed: ctx.revealed })
    ? LISTENING_PREVIEW
    : null;
}

/**
 * The messages whose clips to fetch ahead of time: the other person's Chinese
 * text messages, newest first, at most `limit` — the ones a tap would play.
 * (Listening mode or not: Read aloud uses the same clip.)
 */
export function prefetchSelection<T extends ListeningMessage>(
  messages: readonly T[],
  viewerId: string,
  limit: number = LISTENING_PREFETCH_COUNT,
): T[] {
  const out: T[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    if (listeningCandidate(m, viewerId)) out.push(m);
  }
  return out;
}

/** Rough spoken length (seconds) of a message at the chat's TTS speed, for the "~4 s" label before the clip is known. */
export function estimateSpeechSeconds(text: string): number {
  let han = 0;
  for (const ch of text) if (hasHan(ch)) han++;
  const words = text
    .replace(/[一-鿿㐀-䶿]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
  // ~3 characters a second at the slow chat voice, ~2 Latin words a second.
  return Math.max(1, Math.round(han / 3 + words / 2));
}

/** "0:04" for a duration in seconds. */
export function formatListeningDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The placeholder's bars: `count` heights in 0.25..1, stable per message id
 * (FNV-1a over UTF-16 units, then an LCG), so a hidden bubble looks the same
 * on every render and in both apps.
 */
export function listeningBars(id: string, count: number = 24): number[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const out: number[] = [];
  let s = h >>> 0;
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = s / 0x100000000; // 0..1
    // A soft envelope so the middle is a little taller, like speech.
    const env = 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / count);
    out.push(Math.round((0.25 + 0.75 * v * env) * 100) / 100);
  }
  return out;
}
