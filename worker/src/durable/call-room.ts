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
 *
 * Presence (shared/calls/presence.ts): a socket counts as "in the call" while
 * it is open, hasn't said `leave` and was heard from in the last 45 s (clients
 * ping every 10 s). An alarm follows the plan `planRoom` makes: while someone
 * is present it wakes when the oldest socket would time out (a phone that died
 * without closing its socket is dropped); when nobody is, it wakes at the end
 * deadline and ends the call exactly like the End button (3 min after the last
 * person left, 10 min after creation for a call nobody ever entered). The
 * worker's `GET /api/calls` asks each live room `presence()`, so the banners
 * only announce a call someone is actually in — and that same question sweeps
 * up a room whose deadline passed without an alarm (one created before this).
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
  planRoom,
  isSocketPresent,
  shouldAlertMissed,
  PRESENCE_SEEN_WRITE_MS,
  type RoomSocketLike,
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
  /** Epoch ms the room last heard from this socket (written at most every PRESENCE_SEEN_WRITE_MS). */
  seen?: number;
  /** Said `leave`, was replaced or timed out: no longer counts as present even if the socket lingers. */
  left?: boolean;
  /** Secret for the pagehide beacon (`POST /api/calls/:id/leave`). */
  leaveToken?: string;
}

/** What `presence()` reports to the worker. */
export interface RoomPresence {
  present: string[];
  ended: boolean;
}
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

  private presenceOf(ws: WebSocket, a: Attachment, except?: WebSocket): RoomSocketLike {
    return { userId: a.userId, seen: a.seen ?? 0, open: ws !== except && ws.readyState === WebSocket.OPEN, left: a.left };
  }

  /** Sockets that count as in the call right now (open, not left, heard from recently). */
  private presentSockets(now = Date.now()): { ws: WebSocket; a: Attachment }[] {
    return this.sockets().filter(({ ws, a }) => isSocketPresent(this.presenceOf(ws, a), now));
  }

  private markLeft(ws: WebSocket, a: Attachment): void {
    a.left = true;
    try {
      ws.serializeAttachment(a);
    } catch {
      /* closed under us */
    }
  }

  /** Remember which call this room is, and when it was created (for the "nobody ever came" deadline). */
  private async remember(callId: string, createdAt?: number | null): Promise<void> {
    const [knownId, knownCreated, firstKnown] = await Promise.all([
      this.ctx.storage.get<string>('callId'),
      this.ctx.storage.get<number>('createdAt'),
      this.ctx.storage.get<number>('firstKnownAt'),
    ]);
    const put: Record<string, unknown> = {};
    if (knownId !== callId) put.callId = callId;
    if (!knownCreated && typeof createdAt === 'number' && Number.isFinite(createdAt)) put.createdAt = createdAt;
    if (!firstKnown) put.firstKnownAt = Date.now();
    if (Object.keys(put).length) await this.ctx.storage.put(put);
  }

  /**
   * Apply the presence plan: drop sockets that went silent, end the call when
   * its deadline has passed, otherwise set the alarm for the next look.
   * `leaving` is a socket being closed right now (it no longer counts).
   */
  private async reconcile(leaving?: WebSocket): Promise<RoomPresence> {
    if ((await this.ctx.storage.get<boolean>('ended')) === true) return { present: [], ended: true };
    const now = Date.now();
    const all = this.sockets();
    const [createdAt, firstKnownAt, emptySince, joined] = await Promise.all([
      this.ctx.storage.get<number>('createdAt'),
      this.ctx.storage.get<number>('firstKnownAt'),
      this.ctx.storage.get<number | null>('emptySince'),
      this.ctx.storage.get<string[]>('joined'),
    ]);
    const plan = planRoom({
      now,
      createdAt: createdAt ?? null,
      firstKnownAt: firstKnownAt ?? now,
      everJoined: (joined ?? []).length > 0,
      emptySince: emptySince ?? null,
      ended: false,
      sockets: all.map(({ ws, a }) => this.presenceOf(ws, a, leaving)),
    });
    for (const i of plan.stale) {
      const { ws, a } = all[i];
      this.markLeft(ws, a);
      this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
      try {
        ws.close(4003, 'No answer for a while');
      } catch {
        /* already closed */
      }
    }
    if (plan.stale.length) await this.snapshot();
    if (plan.end) {
      await this.endCall(null);
      return { present: [], ended: true };
    }
    await this.ctx.storage.put('emptySince', plan.emptySince);
    if (plan.wakeAt !== null) await this.ctx.storage.setAlarm(plan.wakeAt);
    return { present: plan.present, ended: false };
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
    await this.remember(callId);
    await this.load();

    const instance = request.headers.get('X-Instance') || undefined;
    // Same user again: the new socket replaces the old. From the same page load it is
    // just a reconnect (the old socket is a dead one) — closed quietly; from anywhere
    // else (a reload, a second device) the old page is told it was replaced.
    const existing = this.sockets();
    for (const { ws, a } of existing) {
      if (a.userId === userId) {
        this.markLeft(ws, a);
        if (instance && a.instance === instance) ws.close(4001, 'Reconnected');
        else {
          this.send(ws, { type: 'replaced' });
          ws.close(4000, 'Joined from somewhere else');
        }
        this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
      }
    }
    // Only people really here count (a partner's phone that died silently is not in the way).
    const others = this.presentSockets().filter(({ a }) => a.userId !== userId);
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
      seen: Date.now(),
      leaveToken: crypto.randomUUID(),
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
    await this.reconcile();

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
      annot_persist: (await this.ctx.storage.get<boolean>('annotPersist')) === true,
      leave_token: attachment.leaveToken,
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
    // Heartbeat: anything from the socket proves it's alive (written at most every few seconds).
    const now = Date.now();
    if (!a.left && now - (a.seen ?? 0) >= PRESENCE_SEEN_WRITE_MS) {
      a.seen = now;
      ws.serializeAttachment(a);
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
      case 'annot_mode': {
        const persist = msg.persist === true;
        this.broadcast({ type: 'annot_mode', from: a.clientId, name: a.name, persist }, ws);
        await this.ctx.storage.put('annotPersist', persist, { allowUnconfirmed: true });
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
      case 'leave':
        await this.leaveSocket(ws, a);
        return;
      case 'end':
        await this.endCall(a.userId);
        return;
    }
  }

  /** Someone left on purpose (Leave, closing the tab): not present from now on; the call goes on. */
  private async leaveSocket(ws: WebSocket, a: Attachment): Promise<void> {
    if (!a.left) {
      this.markLeft(ws, a);
      this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    }
    try {
      ws.close(1000, 'Left the call');
    } catch {
      /* already closed */
    }
    await this.afterLeave(ws);
  }

  /** The pagehide beacon (`POST /api/calls/:id/leave`): the socket's client id + its leave token. */
  async leave(clientId: string, token: string): Promise<boolean> {
    const hit = this.sockets().find(({ a }) => a.clientId === clientId && !!a.leaveToken && a.leaveToken === token);
    if (!hit) return false;
    await this.leaveSocket(hit.ws, hit.a);
    return true;
  }

  /**
   * Who is in the call right now — asked by the worker for every live call it
   * lists. Also the sweeper: a room past its deadline ends here, the same way
   * as its alarm or the End button.
   */
  async presence(callId: string, createdAt: number | null): Promise<RoomPresence> {
    await this.remember(callId, createdAt);
    return this.reconcile();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Complete the closing handshake (not automatic at this compatibility date).
    try {
      ws.close(1000, 'Bye');
    } catch {
      /* already closed */
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a && !a.left) this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    await this.afterLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.afterLeave(ws);
  }

  private async afterLeave(leaving: WebSocket): Promise<void> {
    await this.snapshot();
    await this.reconcile(leaving);
  }

  async alarm(): Promise<void> {
    await this.reconcile();
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
      const endedAt = Date.now();
      const newlyEnded = await markCallEnded(this.env.DB, callId, endedAt);
      // "Missed video call" replaces the ringing notification — not for a room swept up hours later.
      const createdAt = (await this.ctx.storage.get<number>('createdAt')) ?? (await this.ctx.storage.get<number>('firstKnownAt')) ?? null;
      if (newlyEnded && shouldAlertMissed(createdAt, endedAt)) {
        await alertCallMissed(this.env, callId, (await this.ctx.storage.get<string[]>('joined')) ?? []);
      }
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
    await this.remember(callId);
    await this.endCall(by);
  }
}
