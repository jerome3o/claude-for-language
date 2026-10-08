/**
 * How a chat thread is drawn (chat round 2, docs/CHAT.md "Round 2"): Signal-like
 * groups of consecutive bubbles, delivery ticks, photo albums, and the first
 * link of a message (its link preview). Pure — the web (pages/ChatPage.tsx) and
 * the Lab app (core `ChatBubbles.kt`, parity-tested) follow the same rules.
 *
 * Photo albums (docs/CHAT.md "Photo albums"): photos picked together are still
 * one message each (forward / delete / read receipts per photo), but they render
 * as ONE bubble. Members are consecutive messages from one sender with the same
 * `album_id` (set by the sender's app); a deleted member is hidden inside the
 * album, and a run with no photo left shows as one "Message deleted" bubble.
 * Photos sent before albums existed (no album_id) group when they are
 * consecutive photos from one person on one day, each within
 * `ALBUM_LEGACY_GAP_MS` of the one before, and none but the first has a caption.
 */

/** Consecutive messages from one person within this gap form a group. */
export const GROUP_GAP_MS = 3 * 60 * 1000;

/** Photos sent before albums existed: consecutive photos this close together form one album. */
export const ALBUM_LEGACY_GAP_MS = 10 * 1000;

/** At most this many photos are picked at once (so, in one album). */
export const ALBUM_MAX_PHOTOS = 10;

export interface BubbleMessage {
  id: string;
  sender_id: string;
  /** ISO string. */
  created_at: string;
  deleted_at?: string | null;
  /** Outbox state while it hasn't reached the server. */
  pending?: 'sending' | 'failed' | null;
  /** 'image' | 'voice' | 'file' | 'video' — photos can form an album. */
  attachment_kind?: string | null;
  /** The text / a photo's caption (a captioned photo never joins an old-style album). */
  content?: string | null;
  /** Photos picked together share it (set by the sender's app). */
  album_id?: string | null;
}

export type Tick = 'none' | 'pending' | 'failed' | 'sent' | 'read';

export interface BubbleLayout {
  /** The (first shown) message's id. */
  id: string;
  /** One message, or several photos drawn as one album bubble. */
  kind: 'message' | 'album';
  /** The messages this bubble shows, oldest first: `[id]` for a message, the album's photos. */
  messageIds: string[];
  /** Album: the photo whose caption shows under the collage (the last one with a caption), else null. */
  captionId: string | null;
  mine: boolean;
  /** First bubble of its group: a little more space above; the received group's name/top corner. */
  firstInGroup: boolean;
  /** Last bubble of its group: the time + ticks show under it, and its tail corner. */
  lastInGroup: boolean;
  /** A new local day starts here (the "Today" / date separator above it). */
  newDay: boolean;
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  tick: Tick;
}

/** YYYY-MM-DD of an ISO time at a fixed offset (minutes EAST of UTC, i.e. -Date#getTimezoneOffset()). */
export function localDay(iso: string, offsetMinutes: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function tickFor(msg: BubbleMessage, viewerId: string, otherReadAt: string | null | undefined): Tick {
  if (msg.sender_id !== viewerId || msg.deleted_at) return 'none';
  if (msg.pending === 'failed') return 'failed';
  if (msg.pending) return 'pending';
  return otherReadAt && msg.created_at <= otherReadAt ? 'read' : 'sent';
}

/** A photo that can be in an album: an image, not deleted. */
function isPhoto(m: BubbleMessage): boolean {
  return m.attachment_kind === 'image' && !m.deleted_at;
}

function hasCaption(m: BubbleMessage): boolean {
  return !!m.content && m.content.trim() !== '';
}

/**
 * The bubbles of a thread, oldest first: one per message, except that an
 * album's photos are ONE bubble (`kind: 'album'`). Groups, day pills and ticks
 * are worked out over the bubbles: an album is one bubble of its group; its
 * tick is the worst of its photos' (failed, then pending), else its last
 * photo's.
 */
export function layoutBubbles(
  messages: BubbleMessage[],
  viewerId: string,
  otherReadAt: string | null | undefined,
  offsetMinutes: number,
): BubbleLayout[] {
  const days = messages.map((m) => localDay(m.created_at, offsetMinutes));

  // 1. Which messages each bubble shows (indexes into `messages`).
  const items: number[][] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.album_id && (isPhoto(m) || m.deleted_at)) {
      // The album's run: same sender and album id, photos or deleted photos.
      let j = i;
      const run: number[] = [];
      while (j < messages.length) {
        const x = messages[j];
        if (x.album_id !== m.album_id || x.sender_id !== m.sender_id || !(isPhoto(x) || x.deleted_at)) break;
        run.push(j);
        j++;
      }
      const shown = run.filter((k) => isPhoto(messages[k]));
      items.push(shown.length > 0 ? shown : [run[0]]);
      i = j;
      continue;
    }
    if (!m.album_id && isPhoto(m) && !m.pending) {
      // An old-style album: photos sent one after another before album ids existed.
      const run = [i];
      let j = i + 1;
      while (j < messages.length) {
        const prev = messages[j - 1];
        const x = messages[j];
        if (x.album_id || !isPhoto(x) || x.pending || x.sender_id !== m.sender_id || hasCaption(x) || days[j] !== days[j - 1]) break;
        const gap = Date.parse(x.created_at) - Date.parse(prev.created_at);
        if (!(gap >= 0 && gap <= ALBUM_LEGACY_GAP_MS)) break;
        run.push(j);
        j++;
      }
      items.push(run);
      i = j;
      continue;
    }
    items.push([i]);
    i++;
  }

  // 2. Groups, day pills and ticks over the bubbles.
  const first = (k: number) => items[k][0];
  const last = (k: number) => items[k][items[k].length - 1];
  const joins = (a: number, b: number): boolean => {
    if (a < 0 || b >= items.length) return false;
    const x = messages[last(a)];
    const y = messages[first(b)];
    if (x.sender_id !== y.sender_id || days[last(a)] !== days[first(b)]) return false;
    const gap = Date.parse(y.created_at) - Date.parse(x.created_at);
    return gap >= 0 && gap <= GROUP_GAP_MS;
  };
  return items.map((members, k) => {
    const head = messages[members[0]];
    const album = members.length > 1;
    let tick: Tick;
    let captionId: string | null = null;
    if (album) {
      const ticks = members.map((n) => tickFor(messages[n], viewerId, otherReadAt));
      tick = ticks.includes('failed') ? 'failed' : ticks.includes('pending') ? 'pending' : ticks[ticks.length - 1];
      for (const n of members) if (hasCaption(messages[n])) captionId = messages[n].id;
    } else {
      tick = tickFor(head, viewerId, otherReadAt);
    }
    return {
      id: head.id,
      kind: album ? 'album' : 'message',
      messageIds: members.map((n) => messages[n].id),
      captionId,
      mine: head.sender_id === viewerId,
      firstInGroup: !joins(k - 1, k),
      lastInGroup: !joins(k, k + 1),
      newDay: k === 0 || days[first(k)] !== days[last(k - 1)],
      day: days[first(k)],
      tick,
    };
  });
}

/**
 * The album collage: how many tiles show, and the "+N" on the last one.
 * 1 = one photo, 2 = side by side, 3 = one big + two small, 4 = 2 × 2,
 * 5 or more = 2 × 2 with "+N" (the photos not shown) on the fourth tile.
 */
export function albumTiles(count: number): { tiles: number; more: number } {
  const n = Math.max(0, Math.floor(count));
  return { tiles: Math.min(n, 4), more: n > 4 ? n - 4 : 0 };
}

/** "3 / 5" — the album viewer's counter (index 0-based); '' for a single photo. */
export function albumCounter(index: number, count: number): string {
  if (count <= 1) return '';
  return `${Math.min(Math.max(index, 0), count - 1) + 1} / ${count}`;
}

const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'", '。', '，', '；', '：', '！', '？', '）', '」', '』', '》', '、']);

/** The first http(s) link in a text, without trailing punctuation; null when there is none. */
export function firstLink(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'，。！？、）」』》]+/i.exec(text || '');
  if (!m) return null;
  let url = m[0];
  while (url.length > 0 && TRAILING.has(url[url.length - 1])) {
    // Keep a closing parenthesis that has its opening one in the URL (wikipedia links).
    if (url.endsWith(')') && url.split('(').length > url.split(')').length - 1) break;
    url = url.slice(0, -1);
  }
  return /^https?:\/\/[^/]+\.[^/]+/i.test(url) ? url : null;
}
