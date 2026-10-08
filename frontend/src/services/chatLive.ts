/**
 * The live chat channel (docs/CHAT.md §4 + PR 2): ONE WebSocket per tab into
 * my ChatHub, shared by whoever needs it (`acquireChatLive`). POST
 * /api/live/ticket → `wss://…/api/live/ws?ticket=`; ping every 25 s;
 * reconnect with backoff (1 s → 30 s, jittered) while anyone holds it, at once
 * when the browser comes back online or the tab becomes visible again.
 *
 * The socket is a doorbell: listeners get `message` / `message_updated` /
 * `read` / `typing` events, and `onStatus('open')` after every (re)connect is
 * the cue to catch up over REST (`?since=`).
 */

import { getLiveTicket, liveSocketUrl } from '../api/chat';
import type { MessageWithSender } from '../types';

export type ChatLiveEvent =
  | { type: 'hello'; user_id: string; server_time?: string }
  /** `album_count`: a photo of an album of that many (docs/CHAT.md "Photo albums"). */
  | { type: 'message'; message: MessageWithSender; relationship_id?: string; album_count?: number }
  | { type: 'message_updated'; message: MessageWithSender }
  | { type: 'read'; conversation_id: string; user_id: string; last_read_at: string }
  | { type: 'typing'; conversation_id: string; user_id: string }
  | { type: 'pong' };

export type ChatLiveStatus = 'idle' | 'connecting' | 'open' | 'down';

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** Reconnect delay for the nth consecutive failure (1-based): 1 s, 2 s, 4 s … 30 s, ±20 %. */
export function liveBackoffMs(failures: number, random = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Parse a server frame; unknown / malformed frames are dropped. */
export function parseLiveFrame(data: unknown): ChatLiveEvent | null {
  if (typeof data !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  const t = (v as { type?: unknown })?.type;
  if (typeof t !== 'string') return null;
  const e = v as Record<string, unknown>;
  switch (t) {
    case 'message':
    case 'message_updated':
      return e.message && typeof (e.message as { id?: unknown }).id === 'string' ? (v as ChatLiveEvent) : null;
    case 'read':
      return typeof e.conversation_id === 'string' && typeof e.last_read_at === 'string' ? (v as ChatLiveEvent) : null;
    case 'typing':
      return typeof e.conversation_id === 'string' && typeof e.user_id === 'string' ? (v as ChatLiveEvent) : null;
    case 'hello':
    case 'pong':
      return v as ChatLiveEvent;
    default:
      return null;
  }
}

type EventListener = (e: ChatLiveEvent) => void;
type StatusListener = (s: ChatLiveStatus) => void;

class ChatLiveClient {
  private ws: WebSocket | null = null;
  private holders = 0;
  private failures = 0;
  private status: ChatLiveStatus = 'idle';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connecting = false;
  private events = new Set<EventListener>();
  private statuses = new Set<StatusListener>();
  private wired = false;

  getStatus(): ChatLiveStatus {
    return this.status;
  }

  acquire(): () => void {
    this.holders++;
    this.wire();
    if (this.holders === 1) this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders--;
      if (this.holders <= 0) {
        this.holders = 0;
        this.teardown();
      }
    };
  }

  onEvent(l: EventListener): () => void {
    this.events.add(l);
    return () => this.events.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statuses.add(l);
    return () => this.statuses.delete(l);
  }

  /** Send a frame if the socket is open; false otherwise (callers just skip). */
  send(frame: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  private wire() {
    if (this.wired || typeof window === 'undefined') return;
    this.wired = true;
    const kick = () => {
      if (this.holders > 0 && this.status !== 'open' && !this.connecting) {
        this.failures = 0;
        this.clearReconnect();
        this.connect();
      }
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') kick();
    });
  }

  private setStatus(s: ChatLiveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statuses.forEach((l) => {
      try {
        l(s);
      } catch {
        /* ignore */
      }
    });
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async connect() {
    if (this.connecting || this.holders === 0) return;
    if (typeof WebSocket === 'undefined') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('down');
      return;
    }
    this.connecting = true;
    this.setStatus(this.status === 'open' ? 'open' : 'connecting');
    let url: string;
    try {
      const { ticket, ws_path } = await getLiveTicket();
      url = liveSocketUrl(ws_path || '/api/live/ws', ticket);
    } catch (err) {
      this.connecting = false;
      // 503 = no ChatHub on this server: stay on polling, try again much later.
      const status = (err as { status?: number }).status;
      this.scheduleReconnect(status === 503 ? 6 : undefined);
      return;
    }
    if (this.holders === 0) {
      this.connecting = false;
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connecting = false;
      this.failures = 0;
      this.setStatus('open');
      this.startPing();
    };
    ws.onmessage = (ev) => {
      const e = parseLiveFrame(ev.data);
      if (!e) return;
      this.events.forEach((l) => {
        try {
          l(e);
        } catch (err) {
          console.error('[chat-live] listener failed', err);
        }
      });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connecting = false;
      this.stopPing();
      if (this.holders > 0) {
        this.setStatus('down');
        this.scheduleReconnect();
      } else {
        this.setStatus('idle');
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(extraFailures = 0) {
    if (this.holders === 0) return;
    this.setStatus('down');
    this.failures += 1 + extraFailures;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, liveBackoffMs(this.failures));
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private teardown() {
    this.clearReconnect();
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.connecting = false;
    this.failures = 0;
    if (ws) {
      try {
        ws.close(1000, 'released');
      } catch {
        /* ignore */
      }
    }
    this.setStatus('idle');
  }
}

/** The tab's one live connection. */
export const chatLive = new ChatLiveClient();
