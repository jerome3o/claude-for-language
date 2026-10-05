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
 * deadline and ends the call exactly like the End button (10 min after the last
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
  sanitizeAnnotText,
  annotPersistOf,
  keepStroke,
  keepText,
  dropText,
  emptyKept,
  type KeptAnnotations,
  sanitizePing,
  sanitizeSelection,
  sanitizeTextOp,
  sanitizeTextSnapshot,
  sanitizeCompose,
  sanitizeDiagEvents,
  appendDiag,
  PRESENCE_TIMEOUT_MS,
  planRoom,
  ROOM_RETRY_MS,
  isSocketPresent,
  shouldAlertMissed,
  PRESENCE_SEEN_WRITE_MS,
  type RoomSocketLike,
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
  canShow,
  canStopShare,
  nextShown,
  sanitizeShowView,
  type ShownState,
  nextSharedView,
  sanitizeStageView,
  viewForShow,
  type SharedView,
} from '@shared/calls';
import { markCallEnded, saveRoomSnapshot } from '../services/calls/store';
import { loadMaterialAnnotations, notePresented, requireMaterial, saveMaterialAnnotations, shareMaterial } from '../services/materials';
import { materialTarget, parseMaterialTarget, turnPage, type PresentedMaterial } from '@shared/materials';
import { advanceCallProcessing } from '../services/calls/processing';
import { relationshipTutor, saveActivityResult } from '../services/calls/activities';
import { findActivity, joinActivity, reduceActivity, startActivity, type ActivitySession } from '@shared/call-activities';
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
  /** Epoch ms the room last heard from this socket (written at most every PRESENCE_SEEN_WRITE_MS). */
  seen?: number;
  /** Said `leave`, was replaced or timed out: no longer counts as present even if the socket lingers. */
  left?: boolean;
  /** Secret for the pagehide beacon (`POST /api/calls/:id/leave`). */
  leaveToken?: string;
}

/** A page this call opened or wrote on (→ call_board_pages). */
interface PageLink {
  openedAt: number;
  edited: boolean;
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
    try {
      await this.initPages(callId);
    } catch (err) {
      // D1 unreachable: the board still works for this call on a page kept in the room only
      // (not written back, no strip history); a fresh room instance tries D1 again.
      console.error('[call-room] loading board pages failed:', err);
      const id = `tmp-${crypto.randomUUID().slice(0, 8)}`;
      const now = Date.now();
      this.pages = [{ id, title: null, preview: '', chars: 0, created_at: now, updated_at: now, call_id: callId || null, last_used_at: now }];
      this.scope = null;
      this.opening = id;
      this.links = {};
    }
  }

  private async initPages(callId: string): Promise<void> {
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
  /**
   * The room's own line in the connection log (kind 'call'): who entered, left,
   * timed out and who ended the call — and how (2 Oct 2026: nothing said who
   * ended a lesson for both). `who` null = the room itself.
   */
  private async logRoom(detail: string, who: { userId: string; name: string } | null): Promise<void> {
    await this.load();
    this.diag = appendDiag(this.diag!, [{ t: Date.now(), kind: 'call', detail, user_id: who?.userId ?? '', name: who?.name ?? 'Room' }]);
    this.markDirty('diag');
  }

  /** Drawings on a shared screen are kept (round 4: the default for a room that never set it). */
  private async annotPersist(): Promise<boolean> {
    return annotPersistOf(await this.ctx.storage.get<boolean>('annotPersist'));
  }

  /** Storage key of kept annotations: the shared screen's, or a material page's. */
  private keptKey(target: string | null): string {
    return target ? `mannots:${target}` : 'annots';
  }

  private async updateKept(target: string | null, fn: (k: KeptAnnotations) => KeptAnnotations): Promise<void> {
    const k = (await this.ctx.storage.get<KeptAnnotations>(this.keptKey(target))) ?? (target ? await this.loadKeptFromD1(target) : null) ?? emptyKept();
    await this.ctx.storage.put(this.keptKey(target), fn(k), { allowUnconfirmed: true });
    if (target) this.dirtyTargets.add(target);
  }

  /** A message's annotation target: null = the shared screen; a page of the material being presented; false = refuse. */
  private async annotTarget(raw: unknown): Promise<string | null | false> {
    if (raw === undefined || raw === null || raw === '') return null;
    const t = parseMaterialTarget(raw);
    if (!t) return false;
    const cur = await this.ctx.storage.get<PresentedMaterial | null>('presenting');
    return cur && cur.material_id === t.materialId && t.page >= 0 && t.page < cur.page_count ? materialTarget(t.materialId, t.page) : false;
  }

  /** The call's relationship and lesson (asked once). */
  private callMeta: { id: string; relationship_id: string | null; lesson_id: string | null } | null = null;
  private async meta(): Promise<{ id: string; relationship_id: string | null; lesson_id: string | null } | null> {
    if (this.callMeta) return this.callMeta;
    const callId = await this.ctx.storage.get<string>('callId');
    if (!callId) return null;
    const row = await this.env.DB.prepare('SELECT id, relationship_id, lesson_id FROM calls WHERE id = ?').bind(callId).first<{ id: string; relationship_id: string | null; lesson_id: string | null }>();
    this.callMeta = row ?? null;
    return this.callMeta;
  }

  // ---------------------------------------------------------------- in-call activities

  private tutorId: string | null | undefined = undefined;
  /** The tutor of the call's relationship (null in a solo call), asked once per room instance. */
  private async tutor(): Promise<string | null> {
    if (this.tutorId !== undefined) return this.tutorId;
    try {
      this.tutorId = await relationshipTutor(this.env.DB, (await this.meta())?.relationship_id ?? null);
    } catch (err) {
      console.error('[call-room] tutor lookup failed:', err);
      return null;
    }
    return this.tutorId;
  }

  private async activity(): Promise<ActivitySession | null> {
    return (await this.ctx.storage.get<ActivitySession | null>('activity')) ?? null;
  }

  /** Write a session's summary to D1 (the lesson's record of it). Never throws. */
  private async keepActivity(session: ActivitySession | null): Promise<void> {
    if (!session) return;
    try {
      const m = await this.meta();
      if (!m) return;
      await saveActivityResult(this.env.DB, session, { callId: m.id, lessonId: m.lesson_id, relationshipId: m.relationship_id, startedBy: session.host });
    } catch (err) {
      console.error('[call-room] activity result save failed:', err);
    }
  }

  private async startActivityFor(ws: WebSocket, a: Attachment, activityId: string): Promise<void> {
    const spec = findActivity(activityId);
    if (!spec) {
      this.send(ws, { type: 'error', message: 'That activity isn’t available' });
      return;
    }
    await this.keepActivity(await this.activity());
    const present = this.presentSockets();
    const names: Record<string, string> = {};
    for (const { a: p } of present) names[p.userId] = p.name;
    names[a.userId] = a.name;
    const session = startActivity(spec, {
      sessionId: crypto.randomUUID(),
      starter: a.userId,
      tutor: await this.tutor(),
      present: present.map(({ a: p }) => p.userId),
      names,
      now: Date.now(),
    });
    await this.ctx.storage.put('activity', session);
    this.broadcast({ type: 'activity', session, from: a.clientId, name: a.name });
    await this.logRoom(`${a.name} started the activity “${spec.title}”`, a);
  }

  /** Material pages whose kept drawings changed since they were last written to D1 (per lesson). */
  private dirtyTargets = new Set<string>();

  private async loadKeptFromD1(target: string): Promise<KeptAnnotations | null> {
    const t = parseMaterialTarget(target);
    const m = await this.meta();
    if (!t || !m?.lesson_id) return null;
    try {
      const data = await loadMaterialAnnotations(this.env.DB, m.lesson_id, t.materialId, t.page);
      return data ? (JSON.parse(data) as KeptAnnotations) : null;
    } catch (err) {
      console.error('[call-room] material annotations load failed:', err);
      return null;
    }
  }

  private async keptFor(target: string): Promise<KeptAnnotations> {
    return (await this.ctx.storage.get<KeptAnnotations>(this.keptKey(target))) ?? (await this.loadKeptFromD1(target)) ?? emptyKept();
  }

  private async sendMaterialAnnots(p: PresentedMaterial): Promise<void> {
    const target = materialTarget(p.material_id, p.page);
    this.broadcast({ type: 'material_annots', target, annots: await this.keptFor(target) });
  }

  private async notePresentedPage(p: PresentedMaterial): Promise<void> {
    const m = await this.meta();
    if (!m) return;
    try {
      await notePresented(this.env.DB, m.id, p.material_id, p.page);
    } catch (err) {
      console.error('[call-room] notePresented failed:', err);
    }
  }

  /** Present a material: the sender must be able to see it; presenting it in a relationship's call shares it there. */
  private async openMaterial(a: Attachment, materialId: string, page: number): Promise<void> {
    let material;
    try {
      ({ material } = await requireMaterial(this.env.DB, materialId, a.userId));
    } catch {
      this.sendTo(a.clientId, { type: 'error', message: 'That material isn’t available' });
      return;
    }
    if (material.status !== 'ready' || material.page_count < 1) {
      this.sendTo(a.clientId, { type: 'error', message: 'That material is still uploading' });
      return;
    }
    const m = await this.meta();
    if (m?.relationship_id && material.owner_id === a.userId) {
      try {
        await shareMaterial(this.env.DB, material, m.relationship_id, a.userId);
      } catch (err) {
        console.error('[call-room] auto-share failed:', err);
      }
    }
    const presenting: PresentedMaterial = {
      material_id: material.id,
      title: material.title,
      page: turnPage(page, 0, material.page_count),
      page_count: material.page_count,
      by: a.userId,
      by_name: a.name,
    };
    await this.ctx.storage.put('presenting', presenting);
    this.broadcast({ type: 'material', presenting, from: a.clientId, name: a.name });
    await this.sendMaterialAnnots(presenting);
    await this.notePresentedPage(presenting);
  }

  private sendTo(clientId: string, msg: ServerMessage): void {
    const hit = this.sockets().find(({ a }) => a.clientId === clientId);
    if (hit) this.send(hit.ws, msg);
  }

  /** Material pages' kept drawings → D1 (per lesson), on leave / end. */
  private async saveMaterialAnnots(): Promise<void> {
    if (this.dirtyTargets.size === 0) return;
    const m = await this.meta();
    if (!m?.lesson_id) return;
    const targets = [...this.dirtyTargets];
    this.dirtyTargets.clear();
    for (const target of targets) {
      const t = parseMaterialTarget(target);
      if (!t) continue;
      const k = await this.ctx.storage.get<KeptAnnotations>(this.keptKey(target));
      const empty = !k || (k.strokes.length === 0 && k.texts.length === 0);
      try {
        await saveMaterialAnnotations(this.env.DB, m.lesson_id, t.materialId, t.page, empty ? null : JSON.stringify(k));
      } catch (err) {
        console.error('[call-room] material annotations save failed:', err);
        this.dirtyTargets.add(target);
      }
    }
  }

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
    // A call nobody joined never opened a page: nothing to write (and no page to make).
    if (!this.pages && !(await this.ctx.storage.get('pageState'))) return '';
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
    if (callId && scope) await linkCallPages(this.env.DB, callId, links);
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
    if ((await this.ctx.storage.get<boolean>('ended')) === true) {
      // Ended here but maybe not yet in D1 (the write failed): try again on every look.
      await this.finishEnd();
      return { present: [], ended: true };
    }
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
      await this.logRoom(`${a.name} timed out (no answer for ${Math.round(PRESENCE_TIMEOUT_MS / 1000)} s)`, a);
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
      await this.endCall(null, (joined ?? []).length > 0 ? 'automatically: nobody in it' : 'automatically: nobody joined');
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
    await this.loadPages();

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
    await this.logRoom(`${attachment.name} entered${existing.some(({ a }) => a.userId === userId) ? ' again (reconnect / another device)' : ''}`, attachment);
    // Who ever joined: a member who never did gets a "missed call" notification at the end.
    const joined = (await this.ctx.storage.get<string[]>('joined')) ?? [];
    if (!joined.includes(userId)) await this.ctx.storage.put('joined', [...joined, userId]);

    let startedAt = await this.ctx.storage.get<number>('startedAt');
    if (!startedAt) {
      startedAt = Date.now();
      await this.ctx.storage.put('startedAt', startedAt);
    }
    await this.reconcile();

    // An activity started alone: the person joining takes a role in it.
    let activity = await this.activity();
    if (activity) {
      const joined = joinActivity(activity, userId, attachment.name, await this.tutor(), Date.now());
      if (joined) {
        activity = joined;
        await this.ctx.storage.put('activity', joined);
        this.broadcast({ type: 'activity', session: joined }, server);
      }
    }

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
      annot_persist: await this.annotPersist(),
      ...((await this.annotPersist()) ? { annots: (await this.ctx.storage.get<KeptAnnotations>('annots')) ?? emptyKept() } : {}),
      ...(await this.welcomeMaterial()),
      activity,
      pages: this.pageMetas(),
      page: this.opening,
      page_views: Object.fromEntries(others.map(({ a }) => [a.clientId, this.viewOf(a)])),
      leave_token: attachment.leaveToken,
      tutor_id: await this.tutor(),
      shown: (await this.ctx.storage.get<ShownState | null>('shown')) ?? null,
      view: (await this.ctx.storage.get<SharedView | null>('view')) ?? null,
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
        if (!stroke) return;
        const target = await this.annotTarget(msg.target);
        if (target === false) return;
        this.broadcast({ type: 'annot', from: a.clientId, name: a.name, stroke, ...(target ? { target } : {}) }, ws);
        // Kept (round 4: the default): a reconnect gets it back in `welcome`.
        if (stroke.done && (await this.annotPersist())) await this.updateKept(target, (k) => keepStroke(k, a.clientId, a.name, stroke));
        return;
      }
      case 'annot_text': {
        const text = sanitizeAnnotText(msg.text);
        if (!text) return;
        const target = await this.annotTarget(msg.target);
        if (target === false) return;
        this.broadcast({ type: 'annot_text', from: a.clientId, name: a.name, text, ...(target ? { target } : {}) }, ws);
        if (await this.annotPersist()) await this.updateKept(target, (k) => keepText(k, a.clientId, a.name, text));
        return;
      }
      case 'annot_text_delete': {
        const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : '';
        const target = await this.annotTarget(msg.target);
        if (!id || target === false) return;
        this.broadcast({ type: 'annot_text_delete', from: a.clientId, id, ...(target ? { target } : {}) }, ws);
        await this.updateKept(target, (k) => dropText(k, id));
        return;
      }
      case 'annot_mode': {
        const persist = msg.persist === true;
        this.broadcast({ type: 'annot_mode', from: a.clientId, name: a.name, persist }, ws);
        await this.ctx.storage.put('annotPersist', persist, { allowUnconfirmed: true });
        // Fading from now on: what was kept fades on screen, so the room forgets the screen's too.
        if (!persist) await this.ctx.storage.delete('annots');
        return;
      }
      case 'annot_clear': {
        const target = await this.annotTarget(msg.target);
        if (target === false) return;
        this.broadcast({ type: 'annot_clear', from: a.clientId, ...(target ? { target } : {}) }, ws);
        // A material page keeps an empty entry (it overrides what D1 has for the lesson).
        if (target) await this.updateKept(target, () => emptyKept());
        else await this.ctx.storage.delete('annots');
        return;
      }
      case 'annot_ping': {
        const p = sanitizePing(msg);
        const target = await this.annotTarget(msg.target);
        if (p && target !== false) this.broadcast({ type: 'annot_ping', from: a.clientId, name: a.name, x: p.x, y: p.y, ...(target ? { target } : {}) }, ws);
        return;
      }
      case 'material_open': {
        await this.openMaterial(a, typeof msg.material_id === 'string' ? msg.material_id : '', Number(msg.page) || 0);
        return;
      }
      case 'material_page': {
        const cur = await this.ctx.storage.get<PresentedMaterial | null>('presenting');
        if (!cur) return;
        const page = turnPage(Number(msg.page) || 0, 0, cur.page_count);
        if (page === cur.page) return;
        const next = { ...cur, page };
        await this.ctx.storage.put('presenting', next);
        this.broadcast({ type: 'material', presenting: next, from: a.clientId, name: a.name });
        await this.sendMaterialAnnots(next);
        await this.notePresentedPage(next);
        return;
      }
      case 'material_close': {
        await this.ctx.storage.put('presenting', null);
        this.broadcast({ type: 'material', presenting: null, from: a.clientId, name: a.name });
        return;
      }
      case 'activity_start': {
        await this.startActivityFor(ws, a, typeof msg.activity_id === 'string' ? msg.activity_id : '');
        return;
      }
      case 'activity_action': {
        const cur = await this.activity();
        // A stale / refused action: tell just the sender what is true now, so their screen catches up.
        if (!cur || cur.session_id !== msg.session_id) {
          this.send(ws, { type: 'activity', session: cur });
          return;
        }
        const next = reduceActivity(cur, msg.action, a.userId, Date.now());
        if (!next) {
          this.send(ws, { type: 'activity', session: cur });
          return;
        }
        // Relayed first, stored unconfirmed (like typing on the board): a dictation draft is one per keystroke.
        this.broadcast({ type: 'activity', session: next, from: a.clientId, name: a.name });
        await this.ctx.storage.put('activity', next, { allowUnconfirmed: true });
        if (next.phase === 'done' && cur.phase !== 'done') await this.keepActivity(next);
        return;
      }
      case 'activity_close': {
        const cur = await this.activity();
        if (!cur || (msg.session_id && msg.session_id !== cur.session_id)) return;
        await this.keepActivity(cur);
        await this.ctx.storage.put('activity', null);
        this.broadcast({ type: 'activity', session: null, from: a.clientId, name: a.name });
        await this.logRoom(`${a.name} closed the activity “${cur.spec.title}”`, a);
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
      case 'show': {
        await this.showFor(ws, a, msg.view ?? null, msg.follow === true);
        return;
      }
      case 'view': {
        await this.setView(a, msg.view, String(msg.cid ?? ''), msg.bring === true);
        return;
      }
      case 'stop_share': {
        await this.stopTheirShare(ws, a);
        return;
      }
      case 'state': {
        const s = msg.state;
        if (!s || typeof s !== 'object') return;
        a.state = { mic: Boolean(s.mic), cam: Boolean(s.cam), screen: Boolean(s.screen), recording: Boolean(s.recording), ...(s.view === 'own' ? { view: 'own' as const } : s.view === 'same' ? { view: 'same' as const } : {}) };
        ws.serializeAttachment(a);
        this.broadcast({ type: 'peer_state', client_id: a.clientId, state: a.state }, ws);
        return;
      }
      case 'ping':
        this.send(ws, { type: 'pong', t: Number(msg.t) || 0, server_time: Date.now() });
        return;
      case 'leave':
        await this.leaveSocket(ws, a, 'Leave');
        return;
      case 'end':
        await this.endCall(a, 'End for everyone');
        return;
    }
  }

  /**
   * "Show for student" (shared/calls/follow.ts): the relationship's tutor puts a view on the
   * student's stage. Kept in storage so a reconnect (welcome) gets the latest show; everyone
   * hears `shown` (the tutor's button reads "Showing ✓").
   */
  private async showFor(ws: WebSocket, a: Attachment, rawView: unknown, follow: boolean): Promise<void> {
    if (!canShow(a.userId, await this.tutor())) {
      this.send(ws, { type: 'error', message: 'Only the tutor can show things to the student' });
      return;
    }
    const cur = (await this.ctx.storage.get<ShownState | null>('shown')) ?? null;
    if (rawView === null) {
      if (!cur) return;
      await this.ctx.storage.put('shown', null);
      this.broadcast({ type: 'shown', shown: null });
      return;
    }
    const view = sanitizeShowView(rawView);
    if (!view) return;
    const next = nextShown(cur, view, { userId: a.userId, name: a.name }, follow, Date.now(), () => crypto.randomUUID());
    await this.ctx.storage.put('shown', next);
    this.broadcast({ type: 'shown', shown: next });
    if (next.id !== cur?.id) await this.logRoom(`${a.name} showed the ${view.kind === 'text' ? 'board' : view.kind === 'draw' ? 'drawing board' : view.kind} to the student`, a);
    // An older app's show is also a change of the shared view, so newer apps on "Same view" follow it.
    const curView = (await this.ctx.storage.get<SharedView | null>('view')) ?? null;
    await this.setView(a, viewForShow(curView, view), `show:${next.id}:${next.v}`, false);
  }

  /**
   * "Same view" (shared/calls/view.ts): someone's stage changed. The room keeps the latest
   * shared view (a reconnect gets it in `welcome.view`) and tells everyone, the sender
   * included — the room's order decides when two changes cross (last one wins on both screens).
   */
  private async setView(a: Attachment, raw: unknown, cid: string, bring: boolean): Promise<void> {
    const view = sanitizeStageView(raw);
    if (!view) return;
    const cur = (await this.ctx.storage.get<SharedView | null>('view')) ?? null;
    const next = nextSharedView(cur, view, { userId: a.userId, name: a.name }, cid, bring, Date.now());
    await this.ctx.storage.put('view', next);
    this.broadcast({ type: 'view', view: next });
    if (bring) await this.logRoom(`${a.name} brought the other person to their view`, a);
  }

  /** The tutor stops the other person's screen share: their device stops capturing; everyone hears they no longer share. */
  private async stopTheirShare(ws: WebSocket, a: Attachment): Promise<void> {
    const tutor = await this.tutor();
    const targets = this.presentSockets().filter(({ a: t }) => t.userId !== a.userId && t.state.screen);
    if (!targets.length) return;
    if (!targets.every(({ a: t }) => canStopShare(a.userId, tutor, t.userId))) {
      this.send(ws, { type: 'error', message: "Only the tutor can stop the other person's screen share" });
      return;
    }
    for (const { ws: tws, a: t } of targets) {
      this.send(tws, { type: 'share_stopped', by: a.userId, name: a.name });
      t.state = { ...t.state, screen: false };
      tws.serializeAttachment(t);
      this.broadcast({ type: 'peer_state', client_id: t.clientId, state: t.state }, tws);
      await this.logRoom(`${a.name} stopped ${t.name}'s screen share`, a);
    }
  }

  /** Someone left on purpose (Leave, closing the tab): not present from now on; the call goes on. */
  private async leaveSocket(ws: WebSocket, a: Attachment, how: string): Promise<void> {
    if (!a.left) {
      await this.logRoom(`${a.name} left (${how}) — the call goes on`, a);
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
    await this.leaveSocket(hit.ws, hit.a, 'closed the page');
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
    if (a && !a.left) {
      await this.logRoom(`${a.name}'s connection closed`, a);
      this.broadcast({ type: 'peer_left', client_id: a.clientId }, ws);
    }
    await this.afterLeave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.afterLeave(ws);
  }

  private async afterLeave(leaving: WebSocket): Promise<void> {
    // The snapshot is best effort; the presence plan (and with it the end-of-call alarm) must
    // still happen — a failed save used to leave the room without an alarm, the call live.
    try {
      await this.snapshot();
    } catch (err) {
      console.error('[call-room] snapshot on leave failed:', err);
    }
    await this.reconcile(leaving);
  }

  async alarm(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      // The runtime retries a throwing alarm only a few times, then the room never wakes again
      // and the call stays live. Arm our own retry instead.
      console.error('[call-room] alarm failed, trying again shortly:', err);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_RETRY_MS).catch(() => {});
    }
  }

  /** `welcome`: what is presented, and its page's kept drawings. */
  private async welcomeMaterial(): Promise<{ material?: PresentedMaterial | null; material_annots?: { target: string; annots: KeptAnnotations } | null }> {
    const p = (await this.ctx.storage.get<PresentedMaterial | null>('presenting')) ?? null;
    if (!p) return {};
    const target = materialTarget(p.material_id, p.page);
    return { material: p, material_annots: { target, annots: await this.keptFor(target) } };
  }

  private async snapshot(): Promise<void> {
    await this.persistNow();
    await this.saveMaterialAnnots();
    await this.keepActivity(await this.activity());
    const callId = await this.ctx.storage.get<string>('callId');
    if (!callId) return;
    await this.load();
    try {
      const text = await this.savePagesToD1(callId);
      if (this.pages) await this.ctx.storage.put('pageState', this.pageState());
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

  private async endCall(by: { userId: string; name: string } | null, how: string): Promise<void> {
    const endedAt = Date.now();
    // Ended in the room first (nobody can rejoin), with the D1 write still owed: `finishEnd` does
    // it now and, if it fails, again on the retry alarm / the next presence look.
    await this.ctx.storage.put({ ended: true, endedAt, endPending: true });
    await this.ctx.storage.deleteAlarm();
    try {
      await this.logRoom(by ? `${by.name} ended the call for everyone (${how})` : `Call ended ${how}`, by);
      this.broadcast({ type: 'ended', by: by?.userId ?? '' });
      await this.snapshot();
    } catch (err) {
      console.error('[call-room] end: snapshot failed (ending anyway):', err);
    }
    await this.finishEnd();
    for (const { ws } of this.sockets()) {
      try {
        ws.close(1000, 'Call ended');
      } catch {
        /* already closed */
      }
    }
  }

  /** The D1 side of ending (row ended, missed-call push, post-call processing), once; retried until it lands. */
  private async finishEnd(): Promise<void> {
    if ((await this.ctx.storage.get<boolean>('endPending')) !== true) return;
    const callId = await this.ctx.storage.get<string>('callId');
    if (!callId) {
      await this.ctx.storage.put('endPending', false);
      return;
    }
    const endedAt = (await this.ctx.storage.get<number>('endedAt')) ?? Date.now();
    let newlyEnded: boolean;
    try {
      newlyEnded = await markCallEnded(this.env.DB, callId, endedAt);
    } catch (err) {
      console.error('[call-room] marking the call ended failed, trying again shortly:', err);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_RETRY_MS).catch(() => {});
      return;
    }
    await this.ctx.storage.put('endPending', false);
    // "Missed video call" replaces the ringing notification — not for a room swept up hours later.
    const createdAt = (await this.ctx.storage.get<number>('createdAt')) ?? (await this.ctx.storage.get<number>('firstKnownAt')) ?? null;
    if (newlyEnded && shouldAlertMissed(createdAt, endedAt)) {
      try {
        await alertCallMissed(this.env, callId, (await this.ctx.storage.get<string[]>('joined')) ?? []);
      } catch (err) {
        console.error('[call-room] missed-call alert failed:', err);
      }
    }
    try {
      await advanceCallProcessing(this.env, callId);
    } catch (err) {
      console.error('[call-room] processing kick failed:', err);
    }
  }

  /** RPC from the worker when a call is ended over HTTP (e.g. nobody is in the room). */
  async end(callId: string, by: string, how = 'from the app'): Promise<void> {
    await this.remember(callId);
    const here = this.sockets().find(({ a }) => a.userId === by)?.a;
    await this.endCall({ userId: by, name: here?.name ?? 'Someone' }, how);
  }
}
