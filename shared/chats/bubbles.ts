/**
 * How a chat thread is drawn (chat round 2, docs/CHAT.md "Round 2"): Signal-like
 * groups of consecutive bubbles, delivery ticks, and the first link of a message
 * (its link preview). Pure — the web (pages/ChatPage.tsx) and the Lab app
 * (core `ChatBubbles.kt`, parity-tested) follow the same rules.
 */

/** Consecutive messages from one person within this gap form a group. */
export const GROUP_GAP_MS = 3 * 60 * 1000;

export interface BubbleMessage {
  id: string;
  sender_id: string;
  /** ISO string. */
  created_at: string;
  deleted_at?: string | null;
  /** Outbox state while it hasn't reached the server. */
  pending?: 'sending' | 'failed' | null;
}

export type Tick = 'none' | 'pending' | 'failed' | 'sent' | 'read';

export interface BubbleLayout {
  id: string;
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

/** One layout per message, in the order given (oldest first). */
export function layoutBubbles(
  messages: BubbleMessage[],
  viewerId: string,
  otherReadAt: string | null | undefined,
  offsetMinutes: number,
): BubbleLayout[] {
  const days = messages.map((m) => localDay(m.created_at, offsetMinutes));
  const joins = (a: number, b: number): boolean => {
    const x = messages[a];
    const y = messages[b];
    if (!x || !y || x.sender_id !== y.sender_id || days[a] !== days[b]) return false;
    const gap = Date.parse(y.created_at) - Date.parse(x.created_at);
    return gap >= 0 && gap <= GROUP_GAP_MS;
  };
  return messages.map((m, i) => ({
    id: m.id,
    mine: m.sender_id === viewerId,
    firstInGroup: !joins(i - 1, i),
    lastInGroup: !joins(i, i + 1),
    newDay: i === 0 || days[i] !== days[i - 1],
    day: days[i],
    tick: tickFor(m, viewerId, otherReadAt),
  }));
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
