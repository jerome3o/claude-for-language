/**
 * CallRoom — one Durable Object per video call (idFromName(callId)).
 *
 * Relays WebRTC signalling between the two participants (media itself is
 * peer to peer), keeps the shared whiteboard and the in-call chat, and tells
 * everyone when the call ends. Uses the WebSocket Hibernation API, so an idle
 * call costs nothing between messages. Room state lives in the object's own
 * (SQLite-backed) storage and is copied to D1 when people leave and when the
 * call ends, so the review page can show the board and chat.
 *
 * The worker authenticates the socket (a join ticket, see
 * services/calls/ticket.ts) and passes the user in headers; the room trusts
 * those headers because only the worker can reach it.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  applyBoardOp,
  capBoardSize,
  sanitizeBoardOp,
  MAX_CALL_PEERS,
  MAX_CHAT_LENGTH,
  MAX_CHAT_MESSAGES,
  type BoardItem,
  type CallChatMessage,
  type CallPeer,
  type ClientMessage,
  type PeerMediaState,
  type ServerMessage,
} from '@shared/calls';
import { markCallEnded, saveRoomSnapshot } from '../services/calls/store';
import { advanceCallProcessing } from '../services/calls/processing';

interface Attachment {
  clientId: string;
  userId: string;
  name: string;
  picture: string | null;
  state: PeerMediaState;
}

/** An empty room ends the call after this long (everyone closed the tab without pressing End). */
const EMPTY_ROOM_END_MS = 20 * 60_000;
const DEFAULT_STATE: PeerMediaState = { mic: true, cam: true, screen: false, recording: false };

export class CallRoom extends DurableObject<Env> {
  private board: BoardItem[] | null = null;
  private chat: CallChatMessage[] | null = null;

  private async load(): Promise<void> {
    if (this.board && this.chat) return;
    const [board, chat] = await Promise.all([
      this.ctx.storage.get<BoardItem[]>('board'),
      this.ctx.storage.get<CallChatMessage[]>('chat'),
    ]);
    this.board = board ?? [];
    this.chat = chat ?? [];
  }

  private sockets(): { ws: WebSocket; a: Attachment }[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ({ ws, a: ws.deserializeAttachment() as Attachment | null }))
      .filter((x): x is { ws: WebSocket; a: Attachment } => Boolean(x.a));
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing */
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    for (const { ws } of this.sockets()) if (ws !== except) this.send(ws, msg);
  }

  private peerOf(a: Attachment): CallPeer {
    return { client_id: a.clientId, user_id: a.userId, name: a.name, picture_url: a.picture, state: a.state };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const callId = request.headers.get('X-Call-Id') || '';
    const userId = request.headers.get('X-User-Id') || '';
    if (!callId || !userId) return new Response('Missing user', { status: 400 });
    if ((await this.ctx.storage.get<boolean>('ended')) === true) return new Response('Call has ended', { status: 410 });
    await this.ctx.storage.put('callId', callId);
    await this.load();

    // Same user again (a reload, a second device): the new socket replaces the old.
    const existing = this.sockets();
    for (const { ws, a } of existing) {
      if (a.userId === userId) {
        this.send(ws, { type: 'replaced' });
        ws.close(4000, 'Joined from somewhere else');
        this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
      }
    }
    const others = this.sockets().filter(({ ws, a }) => a.userId !== userId && ws.readyState === WebSocket.OPEN);
    if (others.length >= MAX_CALL_PEERS) return new Response('The call is full', { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: Attachment = {
      clientId: crypto.randomUUID(),
      userId,
      name: decodeURIComponent(request.headers.get('X-User-Name') || 'Someone'),
      picture: request.headers.get('X-User-Picture') || null,
      state: { ...DEFAULT_STATE },
    };
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment(attachment);

    let startedAt = await this.ctx.storage.get<number>('startedAt');
    if (!startedAt) {
      startedAt = Date.now();
      await this.ctx.storage.put('startedAt', startedAt);
    }
    await this.ctx.storage.deleteAlarm();

    this.send(server, {
      type: 'welcome',
      client_id: attachment.clientId,
      server_time: Date.now(),
      started_at: startedAt,
      peers: others.map(({ a }) => this.peerOf(a)),
      board: this.board!,
      chat: this.chat!,
    });
    this.broadcast({ type: 'peer_joined', peer: this.peerOf(attachment) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || typeof raw !== 'string' || raw.length > 256_000) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'signal': {
        const target = this.sockets().find(({ a: t }) => t.clientId === msg.to);
        if (target) this.send(target.ws, { type: 'signal', from: a.clientId, data: msg.data });
        return;
      }
      case 'board': {
        const op = sanitizeBoardOp(msg.op, a.userId);
        if (!op) return;
        await this.load();
        this.board = capBoardSize(applyBoardOp(this.board!, op));
        await this.ctx.storage.put('board', this.board);
        this.broadcast({ type: 'board', op }, ws);
        return;
      }
      case 'board_live':
        this.broadcast({ type: 'board_live', from: a.userId, stroke: msg.stroke ?? null }, ws);
        return;
      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LENGTH) : '';
        if (!text) return;
        await this.load();
        const message: CallChatMessage = { id: crypto.randomUUID(), user_id: a.userId, name: a.name, text, at: Date.now() };
        this.chat = [...this.chat!, message].slice(-MAX_CHAT_MESSAGES);
        await this.ctx.storage.put('chat', this.chat);
        this.broadcast({ type: 'chat', message });
        return;
      }
      case 'state': {
        const s = msg.state;
        if (!s || typeof s !== 'object') return;
        a.state = { mic: Boolean(s.mic), cam: Boolean(s.cam), screen: Boolean(s.screen), recording: Boolean(s.recording) };
        ws.serializeAttachment(a);
        this.broadcast({ type: 'peer_state', client_id: a.clientId, state: a.state }, ws);
        return;
      }
      case 'ping':
        this.send(ws, { type: 'pong', t: Number(msg.t) || 0, server_time: Date.now() });
        return;
      case 'end':
        await this.endCall(a.userId);
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Complete the closing handshake (not automatic at this compatibility date).
    try {
      ws.close(1000, 'Bye');
    } catch {
      /* already closed */
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a) this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    await this.afterLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.afterLeave(ws);
  }

  private async afterLeave(leaving: WebSocket): Promise<void> {
    const remaining = this.sockets().filter(({ ws }) => ws !== leaving && ws.readyState === WebSocket.OPEN);
    await this.snapshot();
    if (remaining.length === 0 && !(await this.ctx.storage.get<boolean>('ended'))) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_END_MS);
    }
  }

  async alarm(): Promise<void> {
    const live = this.sockets().filter(({ ws }) => ws.readyState === WebSocket.OPEN);
    if (live.length === 0) await this.endCall(null);
  }

  private async snapshot(): Promise<void> {
    const callId = await this.ctx.storage.get<string>('callId');
    if (!callId) return;
    await this.load();
    try {
      await saveRoomSnapshot(this.env.DB, callId, {
        board: this.board!,
        chat: this.chat!,
        startedAt: (await this.ctx.storage.get<number>('startedAt')) ?? null,
      });
    } catch (err) {
      console.error('[call-room] snapshot failed:', err);
    }
  }

  private async endCall(by: string | null): Promise<void> {
    const callId = await this.ctx.storage.get<string>('callId');
    await this.ctx.storage.put('ended', true);
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ type: 'ended', by: by ?? '' });
    await this.snapshot();
    if (callId) {
      await markCallEnded(this.env.DB, callId);
      try {
        await advanceCallProcessing(this.env, callId);
      } catch (err) {
        console.error('[call-room] processing kick failed:', err);
      }
    }
    for (const { ws } of this.sockets()) {
      try {
        ws.close(1000, 'Call ended');
      } catch {
        /* already closed */
      }
    }
  }

  /** RPC from the worker when a call is ended over HTTP (e.g. nobody is in the room). */
  async end(callId: string, by: string): Promise<void> {
    await this.ctx.storage.put('callId', callId);
    await this.endCall(by);
  }
}
