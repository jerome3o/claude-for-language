/**
 * GroupRoom — one Durable Object per live GROUP class (idFromName(sessionId)).
 * EXPERIMENTAL web-only prototype (docs/GROUP_CLASSES.md), deliberately
 * separate from the 1:1 CallRoom so nothing here can change a 1:1 call.
 *
 * Media is a full mesh: every browser keeps one WebRTC connection to every
 * other one; the room only relays the signalling (`signal` → the addressed
 * client). Besides that it holds the shared text board (the 1:1 board's RGA
 * CRDT, shared/calls/textDoc.ts, one page), the in-class chat, the tutor's
 * controls (mute / mute all / spotlight / hands — shared/group/room.ts) and
 * one quick quiz at a time (shared/group/quiz.ts, per-person views).
 *
 * Presence and auto-end reuse the 1:1 rules (shared/calls/presence.ts
 * `planRoom`): a socket counts while open and heard from in the last 45 s; an
 * empty class ends 10 min after the last person left, an unjoined one 10 min
 * after it was started. When the class ends the room forgets its board, chat
 * and quiz — the prototype keeps nothing after class (no recording either).
 *
 * The worker authenticates the socket (a join ticket bound to
 * `group:<session id>`) and checks membership; the room trusts the headers it
 * passes because only the worker can reach it.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  MAX_CHAT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_TEXT_DOC_CHARS,
  MAX_TEXT_DOC_NODES,
  PRESENCE_SEEN_WRITE_MS,
  ROOM_RETRY_MS,
  TextDoc,
  isSocketPresent,
  planRoom,
  sanitizeCompose,
  sanitizeSelection,
  sanitizeTextOp,
  type CallChatMessage,
  type RoomSocketLike,
  type TextCursor,
  type TextDocSnapshot,
  type TextOp,
  type TextSelection,
} from '@shared/calls';
import {
  EMPTY_ROOM_STATE,
  MAX_GROUP_PEOPLE,
  answerQuiz,
  applyControl,
  personLeft,
  quizViewFor,
  revealQuiz,
  sanitizeControl,
  sanitizePeerState,
  sanitizeQuizSpec,
  startQuiz,
  type GroupClientMessage,
  type GroupPeer,
  type GroupPeerState,
  type GroupQuiz,
  type GroupRole,
  type GroupRoomState,
  type GroupServerMessage,
} from '@shared/group';
import { markSessionEnded } from '../services/group-classes';

interface Attachment {
  clientId: string;
  userId: string;
  name: string;
  picture: string | null;
  role: GroupRole;
  state: GroupPeerState;
  instance?: string;
  sel?: TextSelection | null;
  seen?: number;
  left?: boolean;
  leaveToken?: string;
}

export interface GroupRoomPresence {
  present: string[];
  ended: boolean;
}

const PERSIST_TEXT_MS = 400;

export class GroupRoom extends DurableObject<Env> {
  private doc: TextDoc | null = null;
  private textTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------- storage

  private async getDoc(): Promise<TextDoc> {
    if (!this.doc) this.doc = new TextDoc('room', (await this.ctx.storage.get<TextDocSnapshot>('text')) ?? null);
    return this.doc;
  }

  private persistTextSoon(): void {
    if (this.textTimer) return;
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      void this.persistText();
    }, PERSIST_TEXT_MS);
  }

  private async persistText(): Promise<void> {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    if (this.doc && !(await this.isEnded())) await this.ctx.storage.put('text', this.doc.snapshot());
  }

  private async isEnded(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>('ended')) === true;
  }

  private async room(): Promise<GroupRoomState> {
    return (await this.ctx.storage.get<GroupRoomState>('room')) ?? EMPTY_ROOM_STATE;
  }

  private async tutorId(): Promise<string> {
    return (await this.ctx.storage.get<string>('tutorId')) ?? '';
  }

  /** Remember which session this is, who teaches it and when it was started. */
  private async remember(sessionId: string, tutorId: string, createdAt: number | null): Promise<void> {
    const [known, tutor, created, firstKnown] = await Promise.all([
      this.ctx.storage.get<string>('sessionId'),
      this.ctx.storage.get<string>('tutorId'),
      this.ctx.storage.get<number>('createdAt'),
      this.ctx.storage.get<number>('firstKnownAt'),
    ]);
    const put: Record<string, unknown> = {};
    if (sessionId && known !== sessionId) put.sessionId = sessionId;
    if (tutorId && tutor !== tutorId) put.tutorId = tutorId;
    if (!created && typeof createdAt === 'number' && Number.isFinite(createdAt)) put.createdAt = createdAt;
    if (!firstKnown) put.firstKnownAt = Date.now();
    if (Object.keys(put).length) await this.ctx.storage.put(put);
  }

  // ---------------------------------------------------------------- sockets

  private sockets(): { ws: WebSocket; a: Attachment }[] {
    const out: { ws: WebSocket; a: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) out.push({ ws, a });
    }
    return out;
  }

  private presenceOf(ws: WebSocket, a: Attachment, leaving?: WebSocket): RoomSocketLike {
    return { userId: a.userId, seen: a.seen ?? 0, open: ws !== leaving && ws.readyState === WebSocket.OPEN, left: a.left };
  }

  private presentSockets(now = Date.now()): { ws: WebSocket; a: Attachment }[] {
    return this.sockets().filter(({ ws, a }) => isSocketPresent(this.presenceOf(ws, a), now));
  }

  private presentUsers(): string[] {
    return [...new Set(this.presentSockets().map(({ a }) => a.userId))];
  }

  private markLeft(ws: WebSocket, a: Attachment): void {
    a.left = true;
    try {
      ws.serializeAttachment(a);
    } catch {
      /* closed under us */
    }
  }

  private send(ws: WebSocket, msg: GroupServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }

  private broadcast(msg: GroupServerMessage, except?: WebSocket): void {
    for (const { ws, a } of this.sockets()) if (ws !== except && !a.left) this.send(ws, msg);
  }

  private peerOf(a: Attachment): GroupPeer {
    return { client_id: a.clientId, user_id: a.userId, name: a.name, picture_url: a.picture, role: a.role, state: a.state, ...(a.instance ? { instance: a.instance } : {}) };
  }

  private async sendQuizViews(quiz: GroupQuiz | null, only?: WebSocket): Promise<void> {
    const tutor = await this.tutorId();
    for (const { ws, a } of this.sockets()) {
      if (a.left || (only && ws !== only)) continue;
      this.send(ws, { type: 'quiz', quiz: quiz ? quizViewFor(quiz, a.userId, a.userId === tutor) : null });
    }
  }

  // ---------------------------------------------------------------- join

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const sessionId = request.headers.get('X-Session-Id') || '';
    const userId = request.headers.get('X-User-Id') || '';
    const tutorId = request.headers.get('X-Tutor-Id') || '';
    if (!sessionId || !userId || !tutorId) return new Response('Missing user', { status: 400 });
    if (await this.isEnded()) return new Response('The class has ended', { status: 410 });
    const createdAt = Number(request.headers.get('X-Created-At'));
    await this.remember(sessionId, tutorId, Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null);

    const instance = request.headers.get('X-Instance') || undefined;
    // The same person again (a reload, another tab, a reconnect): the new socket replaces the old.
    for (const { ws, a } of this.sockets()) {
      if (a.userId !== userId || a.left) continue;
      this.markLeft(ws, a);
      if (instance && a.instance === instance) ws.close(4001, 'Reconnected');
      else {
        this.send(ws, { type: 'replaced' });
        ws.close(4000, 'Joined from somewhere else');
      }
      this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    }
    const others = this.presentSockets().filter(({ a }) => a.userId !== userId);
    if (new Set(others.map(({ a }) => a.userId)).size >= MAX_GROUP_PEOPLE) return new Response('The class is full', { status: 409 });

    const room = await this.room();
    const role: GroupRole = userId === tutorId ? 'tutor' : 'student';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: Attachment = {
      clientId: crypto.randomUUID(),
      userId,
      name: decodeURIComponent(request.headers.get('X-User-Name') || 'Someone'),
      picture: request.headers.get('X-User-Picture') || null,
      role,
      // Everyone starts with the mic on unless the tutor muted them; the client corrects it at once.
      state: { mic: !room.muted.includes(userId), cam: true, screen: false },
      ...(instance ? { instance } : {}),
      seen: Date.now(),
      leaveToken: crypto.randomUUID(),
    };
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment(attachment);

    const joined = (await this.ctx.storage.get<string[]>('joined')) ?? [];
    if (!joined.includes(userId)) await this.ctx.storage.put('joined', [...joined, userId]);
    let startedAt = await this.ctx.storage.get<number>('startedAt');
    if (!startedAt) {
      startedAt = Date.now();
      await this.ctx.storage.put('startedAt', startedAt);
    }
    await this.reconcile();

    const doc = await this.getDoc();
    const quiz = (await this.ctx.storage.get<GroupQuiz | null>('quiz')) ?? null;
    this.send(server, {
      type: 'welcome',
      client_id: attachment.clientId,
      server_time: Date.now(),
      started_at: startedAt,
      tutor_id: tutorId,
      me: this.peerOf(attachment),
      peers: others.map(({ a }) => this.peerOf(a)),
      room,
      chat: (await this.ctx.storage.get<CallChatMessage[]>('chat')) ?? [],
      text: doc.snapshot(),
      text_cursors: others.filter(({ a }) => a.sel).map(({ a }) => ({ client_id: a.clientId, user_id: a.userId, name: a.name, sel: a.sel ?? null }) satisfies TextCursor),
      quiz: quiz ? quizViewFor(quiz, userId, role === 'tutor') : null,
      leave_token: attachment.leaveToken!,
    });
    this.broadcast({ type: 'peer_joined', peer: this.peerOf(attachment) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a || a.left || typeof raw !== 'string' || raw.length > 128_000) return;
    let msg: GroupClientMessage;
    try {
      msg = JSON.parse(raw) as GroupClientMessage;
    } catch {
      return;
    }
    const now = Date.now();
    if (now - (a.seen ?? 0) >= PRESENCE_SEEN_WRITE_MS) {
      a.seen = now;
      ws.serializeAttachment(a);
    }
    const tutor = await this.tutorId();
    const isTutor = a.userId === tutor;
    switch (msg.type) {
      case 'signal': {
        const target = this.sockets().find(({ a: t }) => t.clientId === msg.to && !t.left);
        if (target) this.send(target.ws, { type: 'signal', from: a.clientId, data: msg.data });
        return;
      }
      case 'state': {
        const room = await this.room();
        const state = sanitizePeerState(msg.state, room.muted.includes(a.userId));
        if (!state) return;
        a.state = state;
        ws.serializeAttachment(a);
        // To everyone, the sender too: a muted student's "mic on" comes back as off.
        this.broadcast({ type: 'peer_state', client_id: a.clientId, state });
        return;
      }
      case 'control': {
        const control = sanitizeControl(msg.control);
        if (!control) return;
        const before = await this.room();
        const next = applyControl(before, control, { actor: a.userId, tutorId: tutor, present: this.presentUsers(), now });
        if (!next) return;
        await this.ctx.storage.put('room', next);
        this.broadcast({ type: 'room', room: next, by: a.userId, control: control.kind });
        // Newly muted people's mics read off for everyone straight away.
        for (const { ws: w, a: t } of this.sockets()) {
          if (!t.left && t.state.mic && next.muted.includes(t.userId) && !before.muted.includes(t.userId)) {
            t.state = { ...t.state, mic: false };
            w.serializeAttachment(t);
            this.broadcast({ type: 'peer_state', client_id: t.clientId, state: t.state });
          }
        }
        return;
      }
      case 'text': {
        if (!Array.isArray(msg.ops) || msg.ops.length === 0 || msg.ops.length > 50) return;
        const doc = await this.getDoc();
        const accepted: TextOp[] = [];
        for (const rawOp of msg.ops) {
          const site = rawOp && typeof rawOp === 'object' && Array.isArray((rawOp as { id?: unknown }).id) ? String((rawOp as { id: unknown[] }).id[1]) : '';
          // Inserts carry the writer's site "<user id>:<page load>": nobody types as someone else.
          const op = sanitizeTextOp(rawOp, site.startsWith(`${a.userId}:`) ? site : `${a.userId}:`);
          if (!op) continue;
          if (op.t === 'ins' && (doc.length + op.text.length > MAX_TEXT_DOC_CHARS || doc.nodeCount + op.text.length > MAX_TEXT_DOC_NODES)) continue;
          doc.apply(op);
          accepted.push(op);
        }
        if (accepted.length === 0) return;
        this.broadcast({ type: 'text', from: a.clientId, ops: accepted }, ws);
        this.persistTextSoon();
        return;
      }
      case 'text_cursor': {
        const sel = sanitizeSelection(msg.sel);
        const compose = sanitizeCompose(msg.compose);
        a.sel = sel;
        ws.serializeAttachment(a);
        this.broadcast({ type: 'text_cursor', client_id: a.clientId, user_id: a.userId, name: a.name, sel, ...(compose ? { compose } : {}) }, ws);
        return;
      }
      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LENGTH) : '';
        if (!text) return;
        const message: CallChatMessage = { id: crypto.randomUUID(), user_id: a.userId, name: a.name, text, at: now };
        const chat = (await this.ctx.storage.get<CallChatMessage[]>('chat')) ?? [];
        await this.ctx.storage.put('chat', [...chat, message].slice(-MAX_CHAT_MESSAGES));
        this.broadcast({ type: 'chat', message });
        return;
      }
      case 'quiz_start': {
        if (!isTutor) return;
        const spec = sanitizeQuizSpec(msg.quiz);
        if (!spec) {
          this.send(ws, { type: 'error', message: 'A question needs text and 2–6 answers' });
          return;
        }
        const quiz = startQuiz(spec, crypto.randomUUID(), now);
        await this.ctx.storage.put('quiz', quiz);
        await this.sendQuizViews(quiz);
        return;
      }
      case 'quiz_answer': {
        const quiz = await this.ctx.storage.get<GroupQuiz | null>('quiz');
        if (!quiz || isTutor || quiz.id !== msg.quiz_id) return;
        const next = answerQuiz(quiz, a.userId, a.name, msg.choice, now);
        if (!next) return;
        await this.ctx.storage.put('quiz', next);
        await this.sendQuizViews(next);
        return;
      }
      case 'quiz_reveal': {
        const quiz = await this.ctx.storage.get<GroupQuiz | null>('quiz');
        if (!quiz || !isTutor || quiz.id !== msg.quiz_id) return;
        const next = revealQuiz(quiz);
        if (!next) return;
        await this.ctx.storage.put('quiz', next);
        await this.sendQuizViews(next);
        return;
      }
      case 'quiz_close': {
        if (!isTutor) return;
        await this.ctx.storage.put('quiz', null);
        await this.sendQuizViews(null);
        return;
      }
      case 'ping':
        this.send(ws, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0, server_time: now });
        return;
      case 'leave':
        await this.leaveSocket(ws, a);
        return;
      case 'end':
        if (isTutor) await this.endClass(a.name);
        return;
    }
  }

  private async leaveSocket(ws: WebSocket, a: Attachment): Promise<void> {
    if (a.left) return;
    this.markLeft(ws, a);
    this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    await this.afterLeave(ws, a.userId);
    try {
      ws.close(1000, 'Left');
    } catch {
      /* already closed */
    }
  }

  /** The pagehide beacon (POST /api/group-sessions/:id/leave): the socket's client id + its leave token. */
  async leave(clientId: string, token: string): Promise<boolean> {
    const hit = this.sockets().find(({ a }) => a.clientId === clientId && !!a.leaveToken && a.leaveToken === token);
    if (!hit) return false;
    await this.leaveSocket(hit.ws, hit.a);
    return true;
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, 'Bye');
    } catch {
      /* already closed */
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a && !a.left) this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    await this.afterLeave(ws, a?.userId ?? null);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    await this.afterLeave(ws, a?.userId ?? null);
  }

  /** Someone's socket went: when that person has no other socket here, their hand / spotlight go. */
  private async afterLeave(leaving: WebSocket, userId: string | null): Promise<void> {
    if (await this.isEnded()) return;
    await this.persistText().catch(() => {});
    if (userId) {
      const still = this.sockets().some(({ ws, a }) => ws !== leaving && a.userId === userId && isSocketPresent(this.presenceOf(ws, a, leaving), Date.now()));
      if (!still) {
        const room = await this.room();
        const next = personLeft(room, userId);
        if (next !== room) {
          await this.ctx.storage.put('room', next);
          this.broadcast({ type: 'room', room: next }, leaving);
        }
      }
    }
    await this.reconcile(leaving);
  }

  // ---------------------------------------------------------------- presence / end

  private async reconcile(leaving?: WebSocket): Promise<GroupRoomPresence> {
    if (await this.isEnded()) return { present: [], ended: true };
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
    if (plan.end) {
      await this.endClass(null);
      return { present: [], ended: true };
    }
    await this.ctx.storage.put('emptySince', plan.emptySince);
    if (plan.wakeAt !== null) await this.ctx.storage.setAlarm(plan.wakeAt);
    return { present: plan.present, ended: false };
  }

  /** Called by the worker when the tutor starts the class: arms the "nobody came" deadline. */
  async arm(sessionId: string, tutorId: string, createdAt: number): Promise<GroupRoomPresence> {
    await this.remember(sessionId, tutorId, createdAt);
    return this.reconcile();
  }

  async presence(): Promise<GroupRoomPresence> {
    return this.reconcile();
  }

  async alarm(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      console.error('[group-room] alarm failed, trying again shortly:', err);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_RETRY_MS).catch(() => {});
    }
  }

  /** End for everyone (the tutor's End, the worker's end route, or the empty-room deadline). */
  async endClass(byName: string | null): Promise<void> {
    if (await this.isEnded()) return;
    const sessionId = (await this.ctx.storage.get<string>('sessionId')) ?? '';
    const joined = (await this.ctx.storage.get<string[]>('joined')) ?? [];
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    this.doc = null;
    // Nothing is kept after class: board, chat, quiz and controls go with the room.
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put({ ended: true, sessionId });
    await this.ctx.storage.deleteAlarm();
    for (const { ws, a } of this.sockets()) {
      this.send(ws, { type: 'ended', by: byName });
      this.markLeft(ws, a);
      try {
        ws.close(1000, 'Class ended');
      } catch {
        /* already closed */
      }
    }
    if (sessionId) {
      try {
        await markSessionEnded(this.env.DB, sessionId, Date.now(), joined.length);
      } catch (err) {
        console.error('[group-room] marking the session ended failed:', err);
      }
    }
  }
}
