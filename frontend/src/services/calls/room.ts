/**
 * WebSocket to the call room (worker/src/durable/call-room.ts). Each connect
 * asks the API for a fresh one-minute join ticket, then opens the socket; a
 * dropped socket reconnects with backoff until the call ends or the page
 * closes it. Also keeps the server clock offset for the recorder.
 */

import type { ClientMessage, ServerMessage } from '@shared/calls';
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
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** serverTime − localTime (ms). */
  clockOffset = 0;

  constructor(private readonly callId: string, private readonly handlers: RoomHandlers) {}

  async connect(): Promise<void> {
    if (this.closed) return;
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let info: CallJoinInfo;
    try {
      info = await joinCall(this.callId);
    } catch (err) {
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
    if (this.closed) return;
    this.handlers.onJoinInfo?.(info);
    const ws = new WebSocket(callSocketUrl(info.ws_path, info.ticket));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.everOpened = true;
      this.handlers.onStatus('open');
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), 20_000);
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
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
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) this.ws = null;
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

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.attempt++;
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5));
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, 'Left the call');
    this.ws = null;
  }
}
