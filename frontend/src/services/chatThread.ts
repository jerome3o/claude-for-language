/**
 * Pure rules for one chat thread (docs/CHAT.md PR 2 "Client behaviour"):
 * merging server messages by id, the poll cursor, the read receipt under my
 * newest message, the "New messages" divider, image bubble sizing and the
 * conversation-list preview. Unit-tested in chatThread.test.ts.
 */

export interface ThreadMessage {
  id: string;
  sender_id: string;
  created_at: string;
  updated_at?: string | null;
  client_id?: string | null;
  deleted_at?: string | null;
}

/** A message's version: its last change, else its creation (ISO strings compare as strings). */
export function messageVersion(m: ThreadMessage): string {
  return m.updated_at && m.updated_at > m.created_at ? m.updated_at : m.created_at;
}

function byTime(a: ThreadMessage, b: ThreadMessage): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge incoming server messages into the thread by id: a newer (or equal)
 * version replaces the one held, an older one (a slow poll racing a live
 * `message_updated`) is ignored. Oldest first. Returns `prev` itself when
 * nothing changed, so React can skip the render.
 */
export function mergeMessages<T extends ThreadMessage>(prev: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return prev as T[];
  const index = new Map<string, number>();
  prev.forEach((m, i) => index.set(m.id, i));
  let next: T[] | null = null;
  let needsSort = false;
  for (const m of incoming) {
    if (!m || !m.id) continue;
    const i = index.get(m.id);
    if (i === undefined) {
      next = next ?? prev.slice();
      const last = next[next.length - 1];
      if (last && byTime(last, m) > 0) needsSort = true;
      index.set(m.id, next.length);
      next.push(m);
      continue;
    }
    const held = (next ?? prev)[i];
    if (messageVersion(m) < messageVersion(held)) continue;
    if (held === m) continue;
    next = next ?? prev.slice();
    next[i] = m;
  }
  if (!next) return prev as T[];
  if (needsSort) next.sort(byTime);
  return next;
}

/** The poll cursor only moves forward. */
export function advanceCursor(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) return current;
  if (!current || candidate > current) return candidate;
  return current;
}

/** The newest version among messages, as a cursor (`latest_timestamp` fallback). */
export function newestVersion(messages: readonly ThreadMessage[]): string | null {
  let out: string | null = null;
  for (const m of messages) out = advanceCursor(out, messageVersion(m));
  return out;
}

/** Client ids the server already holds (from my messages) — their outbox bubbles go away. */
export function deliveredClientIds(messages: readonly ThreadMessage[], myId: string): Set<string> {
  const out = new Set<string>();
  for (const m of messages) if (m.client_id && m.sender_id === myId) out.add(m.client_id);
  return out;
}

export type ReceiptKind = 'seen' | 'sent';

/**
 * The receipt under my newest (not deleted) message, when it is also the newest
 * message in the thread — once they have replied, a receipt says nothing.
 * Seen = the other person's read marker reached it. Pending / failed sends carry
 * their own state on their bubbles.
 */
export function receiptFor(
  messages: readonly ThreadMessage[],
  myId: string,
  otherReadAt: string | null | undefined,
): { messageId: string; kind: ReceiptKind } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.deleted_at) continue;
    if (m.sender_id !== myId) return null;
    return { messageId: m.id, kind: otherReadAt && otherReadAt >= m.created_at ? 'seen' : 'sent' };
  }
  return null;
}

/**
 * Where the "New messages" divider goes: the first message from the other
 * person after my read marker as it was BEFORE opening. No marker (a chat from
 * before read markers) → no divider, rather than marking the whole history new.
 */
export function firstUnreadId(
  messages: readonly ThreadMessage[],
  myId: string,
  readMarkerBefore: string | null | undefined,
): string | null {
  if (!readMarkerBefore) return null;
  for (const m of messages) {
    if (m.sender_id !== myId && !m.deleted_at && m.created_at > readMarkerBefore) return m.id;
  }
  return null;
}

/** How many messages from the other person arrived after `since` (the "↓ N new" pill). */
export function countNewFromOthers(messages: readonly ThreadMessage[], myId: string, since: string | null): number {
  if (!since) return 0;
  let n = 0;
  for (const m of messages) if (m.sender_id !== myId && m.created_at > since) n++;
  return n;
}

/**
 * A photo bubble's box: the picture's aspect ratio, fitted inside max × max,
 * never wider than it is, with a sane minimum so a sliver stays tappable.
 * Known before the bytes arrive, so nothing jumps when the picture loads.
 */
export function fitImage(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  minSide = 96,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: Math.min(maxWidth, 240), height: Math.min(maxHeight, 180) };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  let w = width * scale;
  let h = height * scale;
  if (w < minSide && h < minSide) {
    const up = minSide / Math.max(w, h);
    w *= up;
    h *= up;
  }
  return { width: Math.round(Math.min(w, maxWidth)), height: Math.round(Math.min(h, maxHeight)) };
}

/** The size to compress a photo to before upload: longest side ≤ max, never upscaled. */
export function scaleToFit(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 0, height: 0 };
  const s = Math.min(1, maxSide / longest);
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** "0:07", "1:23" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** What a conversation row shows for its last message. */
export function lastMessagePreview(
  last: { content?: string | null; deleted_at?: string | null; attachment?: unknown; attachment_kind?: string | null } | null | undefined,
): string {
  if (!last) return '';
  if (last.deleted_at) return 'Message deleted';
  let kind = last.attachment_kind ?? null;
  if (!kind && last.attachment) {
    let a: unknown = last.attachment;
    if (typeof a === 'string') {
      try {
        a = JSON.parse(a);
      } catch {
        a = null;
      }
    }
    kind = (a as { kind?: string } | null)?.kind ?? null;
  }
  const text = (last.content || '').trim();
  if (kind === 'image') return text ? `📷 ${text}` : '📷 Photo';
  if (kind === 'voice') return '🎤 Voice message';
  return text;
}

/** How long "X is typing…" stays after their last typing frame. */
export const TYPING_SHOW_MS = 4000;
/** I send a typing frame at most this often while composing. */
export const TYPING_SEND_EVERY_MS = 2500;

/** Should a typing frame go out now? (box non-empty and changing, throttled). */
export function shouldSendTyping(text: string, lastSentAt: number, now: number): boolean {
  return text.trim().length > 0 && now - lastSentAt >= TYPING_SEND_EVERY_MS;
}
