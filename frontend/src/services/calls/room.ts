/**
 * WebSocket to the call room (worker/src/durable/call-room.ts). Each connect
 * asks the API for a fresh one-minute join ticket, then opens the socket; a
 * dropped socket reconnects with backoff until the call ends or the page
 * closes it. Also keeps the server clock offset for the recorder.
 *
 * The socket carries this page load's `instance`, so the room (and the other
 * person) know a reconnect is the same page — the WebRTC link survives it.
 * A socket that stops answering pings (half-open after a network change) is
 * closed and reopened; so is one when the browser comes back online.
 */

import { ROOM_PING_MS, ROOM_PONG_TIMEOUT_MS, type ClientMessage, type ServerMessage } from '@shared/calls';
import { callSocketUrl, joinCall } from '../../api/calls';
import type { CallJoinInfo } from '../../types/calls';

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomHandlers {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: RoomStatus) => void;
  onJoinInfo?: (info: CallJoinInfo) => void;
  /** A fatal error (the call ended, access refused) — no more reconnects. */
  onFatal: (message: string) => void;
}

export class CallRoomSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private everOpened = false;
  private connecting = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onOnline = () => this.kick('online');
  /** serverTime − localTime (ms). */
  clockOffset = 0;

  constructor(private readonly callId: string, private readonly handlers: RoomHandlers, private readonly instance?: string) {
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    this.handlers.onStatus(this.attempt === 0 && !this.everOpened ? 'connecting' : 'reconnecting');
    let info: CallJoinInfo;
    try {
      info = await joinCall(this.callId);
    } catch (err) {
      this.connecting = false;
      const status = (err as { status?: number }).status;
      // Access / ended errors are final, and so is a first join that keeps failing.
      if (status === 404 || status === 409 || status === 403 || (!this.everOpened && this.attempt >= 3)) {
        this.closed = true;
        this.handlers.onFatal(err instanceof Error ? `Could not join the call: ${err.message}` : 'Could not join the call');
        return;
      }
      this.scheduleReconnect();
      return;
    }
    this.connecting = false;
    if (this.closed) return;
    this.handlers.onJoinInfo?.(info);
    const ws = new WebSocket(callSocketUrl(info.ws_path, info.ticket, this.instance));
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.everOpened = true;
      this.handlers.onStatus('open');
      this.stopTimers();
      this.pingTimer = setInterval(() => this.ping(), ROOM_PING_MS);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return; // a stale socket (replaced by a reconnect)
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (this.pongTimer) {
        clearTimeout(this.pongTimer); // anything from the room proves the socket is alive
        this.pongTimer = null;
      }
      if (msg.type === 'welcome') this.clockOffset = msg.server_time - Date.now();
      if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t;
        if (rtt >= 0 && rtt < 5000) this.clockOffset = msg.server_time + rtt / 2 - Date.now();
      }
      if (msg.type === 'ended' || msg.type === 'replaced') this.closed = true;
      this.handlers.onMessage(msg);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.stopTimers();
      this.ws = null;
      if (this.closed) {
        this.handlers.onStatus('closed');
        return;
      }
      if (event.code === 4000) {
        this.closed = true;
        this.handlers.onFatal('You joined this call from another tab or device.');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private ping(): void {
    if (!this.send({ type: 'ping', t: Date.now() })) return;
    if (this.pongTimer) return;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.kick('no pong');
    }, ROOM_PONG_TIMEOUT_MS);
  }

  /** The socket looks dead (no pong, or the network came back): drop it and reconnect now. */
  private kick(why: string): void {
    if (this.closed) return;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && why === 'online') {
      this.ping(); // probably fine — a missing pong will kick it
      return;
    }
    if (ws) {
      this.ws = null;
      this.stopTimers();
      try {
        ws.close(4002, 'No answer');
      } catch {
        /* already closing */
      }
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = Math.max(1, this.attempt);
    this.handlers.onStatus('reconnecting');
    void this.connect();
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.attempt++;
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt - 1, 5));
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closed = true;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopTimers();
    this.ws?.close(1000, 'Left the call');
    this.ws = null;
  }
}
