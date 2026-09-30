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
  sanitizeAnnotStroke,
  sanitizePing,
  sanitizeSelection,
  sanitizeTextOp,
  sanitizeTextSnapshot,
  sanitizeCompose,
  sanitizeDiagEvents,
  appendDiag,
  snapshotText,
  TextDoc,
  MAX_TEXT_DOC_CHARS,
  MAX_TEXT_DOC_NODES,
  MAX_CALL_PEERS,
  MAX_CHAT_LENGTH,
  MAX_CHAT_MESSAGES,
  type BoardItem,
  type CallChatMessage,
  type CallDiagEntry,
  type CallPeer,
  type ClientMessage,
  type PeerMediaState,
  type ServerMessage,
  type TextCursor,
  type TextDocSnapshot,
  type TextOp,
  type TextSelection,
} from '@shared/calls';
import { markCallEnded, saveRoomSnapshot } from '../services/calls/store';
import { advanceCallProcessing } from '../services/calls/processing';
import { alertCallMissed } from '../services/calls/alerts';

interface Attachment {
  clientId: string;
  userId: string;
  name: string;
  picture: string | null;
  state: PeerMediaState;
  /** Caret / selection on the shared text board (kept here so it survives hibernation). */
  sel?: TextSelection | null;
  /** The page load / app session this socket belongs to (shared/calls/connection.ts). */
  instance?: string;
}

/** An empty room ends the call after this long (everyone closed the tab without pressing End). */
const EMPTY_ROOM_END_MS = 20 * 60_000;
const DEFAULT_STATE: PeerMediaState = { mic: true, cam: true, screen: false, recording: false };
/**
 * Board / text / diagnostics are written to storage at most this often. Edits are
 * relayed first and persisted after, unconfirmed, so a keystroke's relay never
 * waits on a storage write (the output gate would otherwise hold every message
 * until the previous keystroke's write is durable). A lost write is harmless:
 * clients replay the edits the room hasn't confirmed on every rejoin.
 */
const PERSIST_EVERY_MS = 400;

export class CallRoom extends DurableObject<Env> {
  private board: BoardItem[] | null = null;
  private chat: CallChatMessage[] | null = null;
  private text: TextDoc | null = null;
  private diag: CallDiagEntry[] | null = null;
  private dirty = new Set<'board' | 'text' | 'diag'>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private async load(): Promise<void> {
    if (this.board && this.chat && this.text && this.diag) return;
    const [board, chat, text, diag] = await Promise.all([
      this.ctx.storage.get<BoardItem[]>('board'),
      this.ctx.storage.get<CallChatMessage[]>('chat'),
      this.ctx.storage.get<TextDocSnapshot>('text'),
      this.ctx.storage.get<CallDiagEntry[]>('diag'),
    ]);
    this.board = board ?? [];
    this.chat = chat ?? [];
    this.text = new TextDoc('room', sanitizeTextSnapshot(text));
    this.diag = diag ?? [];
  }

  /** Persist soon (coalesced), without holding back the messages already relayed. */
  private markDirty(what: 'board' | 'text' | 'diag'): void {
    this.dirty.add(what);
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, PERSIST_EVERY_MS);
  }

  private async persistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.dirty.size === 0) return;
    const entries: Record<string, unknown> = {};
    if (this.dirty.has('board') && this.board) entries.board = this.board;
    if (this.dirty.has('text') && this.text) entries.text = this.text.snapshot();
    if (this.dirty.has('diag') && this.diag) entries.diag = this.diag;
    this.dirty.clear();
    try {
      await this.ctx.storage.put(entries, { allowUnconfirmed: true });
    } catch (err) {
      console.error('[call-room] persist failed:', err);
    }
  }

  private cursorsExcept(ws: WebSocket): TextCursor[] {
    return this.sockets()
      .filter((x) => x.ws !== ws && x.a.sel)
      .map(({ a }) => ({ client_id: a.clientId, user_id: a.userId, name: a.name, sel: a.sel ?? null }));
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
    return { client_id: a.clientId, user_id: a.userId, name: a.name, picture_url: a.picture, state: a.state, ...(a.instance ? { instance: a.instance } : {}) };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const callId = request.headers.get('X-Call-Id') || '';
    const userId = request.headers.get('X-User-Id') || '';
    if (!callId || !userId) return new Response('Missing user', { status: 400 });
    if ((await this.ctx.storage.get<boolean>('ended')) === true) return new Response('Call has ended', { status: 410 });
    await this.ctx.storage.put('callId', callId);
    await this.load();

    const instance = request.headers.get('X-Instance') || undefined;
    // Same user again: the new socket replaces the old. From the same page load it is
    // just a reconnect (the old socket is a dead one) — closed quietly; from anywhere
    // else (a reload, a second device) the old page is told it was replaced.
    const existing = this.sockets();
    for (const { ws, a } of existing) {
      if (a.userId === userId) {
        if (instance && a.instance === instance) ws.close(4001, 'Reconnected');
        else {
          this.send(ws, { type: 'replaced' });
          ws.close(4000, 'Joined from somewhere else');
        }
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
      ...(instance ? { instance } : {}),
    };
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment(attachment);
    // Who ever joined: a member who never did gets a "missed call" notification at the end.
    const joined = (await this.ctx.storage.get<string[]>('joined')) ?? [];
    if (!joined.includes(userId)) await this.ctx.storage.put('joined', [...joined, userId]);

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
      text: this.text!.snapshot(),
      text_cursors: this.cursorsExcept(server),
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
        this.broadcast({ type: 'board', op }, ws);
        this.markDirty('board');
        return;
      }
      case 'text': {
        // The shared text board: validate, apply to the room's copy, keep it, pass it on in this order.
        if (!Array.isArray(msg.ops) || msg.ops.length === 0 || msg.ops.length > 50) return;
        await this.load();
        const doc = this.text!;
        const accepted: TextOp[] = [];
        for (const raw of msg.ops) {
          const site = raw && typeof raw === 'object' && Array.isArray((raw as { id?: unknown }).id) ? String((raw as { id: unknown[] }).id[1]) : '';
          // Inserts carry the writer's site: "<user id>:<page load>", so nobody can type as someone else.
          const op = sanitizeTextOp(raw, site.startsWith(`${a.userId}:`) ? site : `${a.userId}:`);
          if (!op) continue;
          if (op.t === 'ins' && (doc.length + op.text.length > MAX_TEXT_DOC_CHARS || doc.nodeCount + op.text.length > MAX_TEXT_DOC_NODES)) continue;
          doc.apply(op);
          accepted.push(op);
        }
        if (accepted.length === 0) return;
        // Relay first: the other person sees the keystroke now; the storage write follows.
        this.broadcast({ type: 'text', from: a.clientId, ops: accepted }, ws);
        this.markDirty('text');
        return;
      }
      case 'text_cursor': {
        const sel = sanitizeSelection(msg.sel);
        const compose = sanitizeCompose(msg.compose);
        this.broadcast({ type: 'text_cursor', client_id: a.clientId, user_id: a.userId, name: a.name, sel, ...(compose ? { compose } : {}) }, ws);
        a.sel = sel;
        ws.serializeAttachment(a);
        return;
      }
      case 'annot': {
        const stroke = sanitizeAnnotStroke(msg.stroke);
        if (stroke) this.broadcast({ type: 'annot', from: a.clientId, name: a.name, stroke }, ws);
        return;
      }
      case 'annot_clear':
        this.broadcast({ type: 'annot_clear', from: a.clientId }, ws);
        return;
      case 'annot_ping': {
        const p = sanitizePing(msg);
        if (p) this.broadcast({ type: 'annot_ping', from: a.clientId, name: a.name, x: p.x, y: p.y }, ws);
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
        this.broadcast({ type: 'chat', message });
        await this.ctx.storage.put('chat', this.chat, { allowUnconfirmed: true });
        return;
      }
      case 'diag': {
        const events = sanitizeDiagEvents(msg.events);
        if (events.length === 0) return;
        await this.load();
        this.diag = appendDiag(this.diag!, events.map((e) => ({ ...e, user_id: a.userId, name: a.name })));
        this.markDirty('diag');
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
    await this.persistNow();
    const callId = await this.ctx.storage.get<string>('callId');
    if (!callId) return;
    await this.load();
    try {
      await saveRoomSnapshot(this.env.DB, callId, {
        board: this.board!,
        chat: this.chat!,
        text: this.text ? this.text.text() : snapshotText(null),
        diagnostics: this.diag ?? [],
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
      const newlyEnded = await markCallEnded(this.env.DB, callId);
      if (newlyEnded) await alertCallMissed(this.env, callId, (await this.ctx.storage.get<string[]>('joined')) ?? []);
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
