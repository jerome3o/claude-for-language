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
  TextDoc,
  pickOpeningPage,
  pagePreview,
  pageAfterDelete,
  pageLabel,
  sanitizePageId,
  sanitizePageTitle,
  snapshotFromText,
  combineCallPagesText,
  MAX_BOARD_PAGES,
  type BoardPageMeta,
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
import { insertPage, linkCallPages, loadPageDoc, loadScopePages, savePages, type PageScope, type PageWrite, type RoomPage } from '../services/calls/pages';

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
  /** The board page this socket looks at (absent = the call's opening page). */
  page?: string;
}

/** A page this call opened or wrote on (→ call_board_pages). */
interface PageLink {
  openedAt: number;
  edited: boolean;
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
  private diag: CallDiagEntry[] | null = null;
  private dirty = new Set<'board' | 'diag' | 'pages'>();
  /** Board pages of the call's relationship (strip order), loaded once per room. */
  private pages: RoomPage[] | null = null;
  private scope: PageScope | null = null;
  private opening = '';
  private links: Record<string, PageLink> = {};
  /** Loaded page documents. */
  private docs = new Map<string, TextDoc>();
  /** Documents changed since the last storage write / since the last D1 write. */
  private dirtyDocs = new Set<string>();
  private d1Dirty = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private async load(): Promise<void> {
    if (this.board && this.chat && this.diag) return;
    const [board, chat, diag] = await Promise.all([
      this.ctx.storage.get<BoardItem[]>('board'),
      this.ctx.storage.get<CallChatMessage[]>('chat'),
      this.ctx.storage.get<CallDiagEntry[]>('diag'),
    ]);
    this.board = board ?? [];
    this.chat = chat ?? [];
    this.diag = diag ?? [];
  }

  /**
   * The relationship's board pages. The first time (the first join) the room
   * reads them from D1 and picks the page the call opens on (pickOpeningPage:
   * today's page within the lesson window, else a new one); afterwards they
   * live in the room's storage until the call ends.
   */
  private async loadPages(): Promise<void> {
    if (this.pages) return;
    const stored = await this.ctx.storage.get<{ pages: RoomPage[]; scope: PageScope; opening: string; links: Record<string, PageLink>; d1Dirty: string[] }>('pageState');
    if (stored) {
      this.pages = stored.pages;
      this.scope = stored.scope;
      this.opening = stored.opening;
      this.links = stored.links ?? {};
      this.d1Dirty = new Set(stored.d1Dirty ?? []);
      return;
    }
    const callId = (await this.ctx.storage.get<string>('callId')) ?? '';
    const call = await this.env.DB
      .prepare('SELECT c.relationship_id, c.created_by, u.time_zone FROM calls c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?')
      .bind(callId)
      .first<{ relationship_id: string | null; created_by: string; time_zone: string | null }>();
    const scope: PageScope = { relationshipId: call?.relationship_id ?? null, userId: call?.created_by ?? '' };
    const pages = await loadScopePages(this.env.DB, scope);
    const now = Date.now();
    // A call that was live across the deploy that brought pages keeps what it had typed.
    const legacy = sanitizeTextSnapshot(await this.ctx.storage.get<TextDocSnapshot>('text'));
    const choice = legacy && legacy.runs.length > 0 ? ({ kind: 'new' } as const) : pickOpeningPage(pages, now, call?.time_zone);
    let opening: string;
    if (choice.kind === 'continue') {
      opening = choice.id;
    } else {
      const page = await insertPage(this.env.DB, scope, { position: pages.length + 1, callId: callId || null, doc: legacy, now });
      pages.push(page);
      opening = page.id;
      if (legacy) this.docs.set(page.id, new TextDoc('room', legacy));
    }
    this.pages = pages;
    this.scope = scope;
    this.opening = opening;
    this.links = { [opening]: { openedAt: now, edited: false } };
    await savePages(this.env.DB, scope, [{ id: opening, last_used_at: now }]);
    if (callId) await linkCallPages(this.env.DB, callId, [{ pageId: opening, text: '', edited: false, openedAt: now }]);
    await this.ctx.storage.put('pageState', this.pageState());
  }

  private pageState() {
    return { pages: this.pages ?? [], scope: this.scope, opening: this.opening, links: this.links, d1Dirty: [...this.d1Dirty] };
  }

  private pageMetas(): BoardPageMeta[] {
    return (this.pages ?? []).map(({ last_used_at: _u, ...meta }) => meta);
  }

  private hasPage(id: string | null | undefined): id is string {
    return Boolean(id && this.pages?.some((p) => p.id === id));
  }

  /** The page a socket looks at (a gone page → the opening page). */
  private viewOf(a: Attachment): string {
    return this.hasPage(a.page) ? a.page : this.opening;
  }

  private async getDoc(pageId: string): Promise<TextDoc> {
    const loaded = this.docs.get(pageId);
    if (loaded) return loaded;
    let snap = sanitizeTextSnapshot(await this.ctx.storage.get<TextDocSnapshot>(`page:${pageId}`));
    if (!snap && this.scope) snap = await loadPageDoc(this.env.DB, this.scope, pageId);
    const doc = new TextDoc('room', snap);
    this.docs.set(pageId, doc);
    return doc;
  }

  private link(pageId: string, edited: boolean): void {
    const cur = this.links[pageId];
    if (cur && (cur.edited || !edited)) return;
    this.links[pageId] = { openedAt: cur?.openedAt ?? Date.now(), edited: edited || Boolean(cur?.edited) };
    this.markDirty('pages');
  }

  private pageDoc(ws: WebSocket, pageId: string, doc: TextDoc): void {
    this.send(ws, { type: 'page_doc', page: pageId, text: doc.snapshot(), text_cursors: this.cursorsExcept(ws, pageId) });
  }

  /** Move a socket onto a page: its document, and everyone else is told where it is. */
  private async openPage(ws: WebSocket, a: Attachment, pageId: string): Promise<void> {
    a.page = pageId;
    a.sel = null;
    ws.serializeAttachment(a);
    this.link(pageId, false);
    this.pageDoc(ws, pageId, await this.getDoc(pageId));
    this.broadcast({ type: 'page_view', client_id: a.clientId, page: pageId }, ws);
  }

  /** Positions follow the strip order; write the ones that changed. */
  private renumber(): PageWrite[] {
    return (this.pages ?? []).map((p, i) => ({ id: p.id, position: i + 1 }));
  }

  /** Persist soon (coalesced), without holding back the messages already relayed. */
  private markDirty(what: 'board' | 'diag' | 'pages'): void {
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
    if (this.dirty.has('diag') && this.diag) entries.diag = this.diag;
    const previews: BoardPageMeta[] = [];
    for (const id of this.dirtyDocs) {
      const doc = this.docs.get(id);
      if (!doc) continue;
      entries[`page:${id}`] = doc.snapshot();
      this.d1Dirty.add(id);
      const meta = this.pages?.find((p) => p.id === id);
      if (meta) {
        const text = doc.text();
        meta.preview = pagePreview(text);
        meta.chars = doc.length;
        meta.updated_at = Date.now();
        meta.last_used_at = meta.updated_at;
        previews.push(meta);
      }
    }
    if (this.dirtyDocs.size || this.dirty.has('pages')) entries.pageState = this.pageState();
    this.dirtyDocs.clear();
    this.dirty.clear();
    // Thumbnails in the strip follow the typing (at most every PERSIST_EVERY_MS).
    for (const p of previews) this.broadcast({ type: 'page_preview', page: p.id, preview: p.preview, chars: p.chars, updated_at: p.updated_at });
    if (Object.keys(entries).length === 0) return;
    try {
      await this.ctx.storage.put(entries, { allowUnconfirmed: true });
    } catch (err) {
      console.error('[call-room] persist failed:', err);
    }
  }

  /** The pages this call changed → D1, and the call's links (with each page's text now). */
  private async savePagesToD1(callId: string): Promise<string> {
    await this.loadPages();
    const scope = this.scope;
    const pages = this.pages ?? [];
    if (scope) {
      const writes: PageWrite[] = [];
      for (const id of this.d1Dirty) {
        const doc = this.docs.get(id);
        const meta = pages.find((p) => p.id === id);
        if (doc && meta) writes.push({ id, doc: doc.snapshot(), updated_at: meta.updated_at, last_used_at: meta.last_used_at });
      }
      await savePages(this.env.DB, scope, writes);
      this.d1Dirty.clear();
    }
    const texts: { label: string; text: string }[] = [];
    const links: { pageId: string; text: string; edited: boolean; openedAt: number }[] = [];
    for (const [i, p] of pages.entries()) {
      const l = this.links[p.id];
      if (!l) continue;
      const text = this.docs.has(p.id) ? (await this.getDoc(p.id)).text() : null;
      if (text !== null) links.push({ pageId: p.id, text, edited: l.edited, openedAt: l.openedAt });
      if (l.edited && text !== null) texts.push({ label: pageLabel(i, p.title), text });
    }
    if (callId) await linkCallPages(this.env.DB, callId, links);
    return combineCallPagesText(texts);
  }

  private cursorsExcept(ws: WebSocket, pageId: string): TextCursor[] {
    return this.sockets()
      .filter((x) => x.ws !== ws && x.a.sel && this.viewOf(x.a) === pageId)
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
    await this.loadPages();

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
      text: (await this.getDoc(this.opening)).snapshot(),
      text_cursors: this.cursorsExcept(server, this.opening),
      annot_persist: (await this.ctx.storage.get<boolean>('annotPersist')) === true,
      pages: this.pageMetas(),
      page: this.opening,
      page_views: Object.fromEntries(others.map(({ a }) => [a.clientId, this.viewOf(a)])),
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
        // The shared text board: validate, apply to the room's copy of that page, keep it, pass it on in this order.
        if (!Array.isArray(msg.ops) || msg.ops.length === 0 || msg.ops.length > 50) return;
        await this.loadPages();
        // No page = an older client, which only knows the page it was welcomed on.
        const pageId = msg.page === undefined ? this.viewOf(a) : sanitizePageId(msg.page);
        if (!this.hasPage(pageId)) return;
        const doc = await this.getDoc(pageId);
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
        // Relay first (to whoever looks at that page): the other person sees the keystroke now; the storage write follows.
        for (const x of this.sockets()) {
          if (x.ws !== ws && this.viewOf(x.a) === pageId) this.send(x.ws, { type: 'text', from: a.clientId, ops: accepted, page: pageId });
        }
        this.dirtyDocs.add(pageId);
        this.link(pageId, true);
        this.markDirty('pages');
        return;
      }
      case 'text_cursor': {
        const sel = sanitizeSelection(msg.sel);
        const compose = sanitizeCompose(msg.compose);
        await this.loadPages();
        const pageId = this.viewOf(a);
        // A caret for a page this socket isn't on (a late message after a page switch) is dropped.
        if (msg.page !== undefined && sanitizePageId(msg.page) !== pageId) return;
        for (const x of this.sockets()) {
          if (x.ws !== ws && this.viewOf(x.a) === pageId) {
            this.send(x.ws, { type: 'text_cursor', client_id: a.clientId, user_id: a.userId, name: a.name, sel, page: pageId, ...(compose ? { compose } : {}) });
          }
        }
        a.sel = sel;
        ws.serializeAttachment(a);
        return;
      }
      case 'page_open': {
        await this.loadPages();
        const pageId = sanitizePageId(msg.page);
        if (!this.hasPage(pageId)) {
          this.send(ws, { type: 'pages', pages: this.pageMetas() });
          return;
        }
        await this.openPage(ws, a, pageId);
        return;
      }
      case 'page_new':
      case 'page_duplicate': {
        await this.loadPages();
        const pages = this.pages!;
        if (!this.scope || pages.length >= MAX_BOARD_PAGES) {
          this.send(ws, { type: 'error', message: 'This board has as many pages as it can hold' });
          return;
        }
        const callId = (await this.ctx.storage.get<string>('callId')) ?? null;
        const scope = { ...this.scope, userId: this.scope.relationshipId ? a.userId : this.scope.userId };
        let at = pages.length;
        let doc: TextDocSnapshot | null = null;
        let title: string | null = null;
        if (msg.type === 'page_duplicate') {
          const src = sanitizePageId(msg.page);
          if (!this.hasPage(src)) return;
          at = pages.findIndex((p) => p.id === src) + 1;
          const srcMeta = pages[at - 1];
          doc = snapshotFromText((await this.getDoc(src)).text(), `copy:${crypto.randomUUID().slice(0, 8)}`);
          title = srcMeta.title ? sanitizePageTitle(`${srcMeta.title} (copy)`) : null;
        }
        const page = await insertPage(this.env.DB, scope, { position: at + 1, title, doc, callId });
        pages.splice(at, 0, page);
        this.docs.set(page.id, new TextDoc('room', doc));
        if (at < pages.length - 1) await savePages(this.env.DB, this.scope, this.renumber());
        this.markDirty('pages');
        this.broadcast({ type: 'pages', pages: this.pageMetas() });
        await this.openPage(ws, a, page.id);
        return;
      }
      case 'page_rename': {
        await this.loadPages();
        const pageId = sanitizePageId(msg.page);
        const meta = this.pages!.find((p) => p.id === pageId);
        if (!meta || !this.scope) return;
        meta.title = sanitizePageTitle(msg.title);
        await savePages(this.env.DB, this.scope, [{ id: meta.id, title: meta.title }]);
        this.markDirty('pages');
        this.broadcast({ type: 'pages', pages: this.pageMetas() });
        return;
      }
      case 'page_delete': {
        await this.loadPages();
        const pageId = sanitizePageId(msg.page);
        const pages = this.pages!;
        if (!this.hasPage(pageId) || !this.scope) return;
        if (pages.length <= 1) {
          this.send(ws, { type: 'error', message: "The board's last page can't be deleted" });
          return;
        }
        const fallback = pageAfterDelete(pages.map((p) => p.id), pageId)!;
        // Keep what the page held in this call's record before it goes.
        if (this.links[pageId]?.edited) await this.savePagesToD1((await this.ctx.storage.get<string>('callId')) ?? '');
        this.pages = pages.filter((p) => p.id !== pageId);
        await savePages(this.env.DB, this.scope, [{ id: pageId, deleted_at: Date.now() }]);
        this.docs.delete(pageId);
        this.dirtyDocs.delete(pageId);
        this.d1Dirty.delete(pageId);
        if (this.opening === pageId) this.opening = fallback;
        for (const x of this.sockets()) {
          if (x.a.page === pageId) {
            x.a.page = fallback;
            x.a.sel = null;
            x.ws.serializeAttachment(x.a);
          }
        }
        this.markDirty('pages');
        this.broadcast({ type: 'pages', pages: this.pageMetas() });
        this.broadcast({ type: 'page_deleted', page: pageId, fallback, by: a.name });
        return;
      }
      case 'page_summon': {
        await this.loadPages();
        const pageId = sanitizePageId(msg.page);
        if (this.hasPage(pageId)) this.broadcast({ type: 'page_summon', from: a.clientId, name: a.name, page: pageId }, ws);
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
      const text = await this.savePagesToD1(callId);
      await this.ctx.storage.put('pageState', this.pageState());
      await saveRoomSnapshot(this.env.DB, callId, {
        board: this.board!,
        chat: this.chat!,
        text,
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
