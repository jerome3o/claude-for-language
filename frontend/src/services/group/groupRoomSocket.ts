/**
 * WebSocket to a group class's GroupRoom (EXPERIMENTAL; worker
 * durable/group-room.ts). A trimmed copy of the 1:1 CallRoomSocket: a fresh
 * one-minute ticket per connect, ping / pong, reconnect with backoff until the
 * class ends or the page leaves.
 */

import { ROOM_PING_MS, ROOM_PONG_TIMEOUT_MS } from '@shared/calls';
import type { GroupClientMessage, GroupServerMessage } from '@shared/group';
import { groupSocketUrl, joinGroupSession, sendGroupLeaveBeacon } from '../../api/groupClasses';
import type { CallJoinInfo } from '../../types/calls';

export type GroupRoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GroupRoomHandlers {
  onMessage: (msg: GroupServerMessage) => void;
  onStatus: (status: GroupRoomStatus) => void;
  onJoinInfo: (info: CallJoinInfo) => void;
  onFatal: (message: string) => void;
}

export class GroupRoomSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private everOpened = false;
  private connecting = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveKey: { clientId: string; token: string } | null = null;

  constructor(private readonly sessionId: string, private readonly handlers: GroupRoomHandlers, private readonly instance: string) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    this.handlers.onStatus(this.everOpened ? 'reconnecting' : 'connecting');
    let info: CallJoinInfo;
    try {
      info = await joinGroupSession(this.sessionId);
    } catch (err) {
      this.connecting = false;
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 409 || status === 403 || status === 503 || (!this.everOpened && this.attempt >= 3)) {
        this.closed = true;
        this.handlers.onFatal(err instanceof Error ? err.message : 'Could not join the class');
        return;
      }
      this.retry();
      return;
    }
    this.connecting = false;
    if (this.closed) return;
    this.handlers.onJoinInfo(info);
    const ws = new WebSocket(groupSocketUrl(info.ws_path, info.ticket, this.instance));
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
      if (this.ws !== ws) return;
      let msg: GroupServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as GroupServerMessage;
      } catch {
        return;
      }
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
      if (msg.type === 'welcome') this.leaveKey = { clientId: msg.client_id, token: msg.leave_token };
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
        this.handlers.onFatal('You joined this class from another tab or device.');
        return;
      }
      this.retry();
    };
  }

  private ping(): void {
    if (!this.send({ type: 'ping', t: Date.now() }) || this.pongTimer) return;
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      const ws = this.ws;
      this.ws = null;
      this.stopTimers();
      try {
        ws?.close(4002, 'No answer');
      } catch {
        /* closing anyway */
      }
      this.retry();
    }, ROOM_PONG_TIMEOUT_MS);
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private retry(): void {
    if (this.closed) return;
    this.attempt++;
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt - 1, 5));
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  send(msg: GroupClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(opts: { beacon?: boolean } = {}): void {
    const was = this.closed;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopTimers();
    if (!was) {
      this.send({ type: 'leave' });
      if (opts.beacon && this.leaveKey) sendGroupLeaveBeacon(this.sessionId, this.leaveKey.clientId, this.leaveKey.token);
    }
    this.ws?.close(1000, 'Left the class');
    this.ws = null;
  }
}
