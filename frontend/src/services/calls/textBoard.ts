/**
 * The shared text board's client side: this page's replica of the document
 * (shared/calls/textDoc.ts), the edits not yet accepted by the room, the other
 * person's caret, and the IME rule — while a Chinese pinyin composition is in
 * progress nothing is sent and the other person's edits wait, so the
 * composition window is never disturbed; both catch up on compositionend.
 *
 * Board pages (shared/calls/pages.ts): the board is one of the relationship's
 * numbered pages. This session also keeps the page list, which page each
 * person looks at, and "Follow <name>" — each person turns pages on their own;
 * while following, my view jumps whenever theirs does (turning a page myself
 * stops it); "Bring <name> here" moves them to my page.
 */

import {
  TextDoc,
  pageLabel,
  presenceColor,
  type BoardPageMeta,
  type CharId,
  type TextCursor,
  type TextDocSnapshot,
  type TextOp,
  type TextSelection,
} from '@shared/calls';

export interface RemoteCaret {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  sel: TextSelection;
  /** Their pinyin composition in progress (shown in their name flag, not in the text). */
  compose: string | null;
}

type Sender = (
  msg:
    | { type: 'text'; ops: TextOp[]; page?: string }
    | { type: 'text_cursor'; sel: TextSelection | null; compose?: string | null; page?: string }
    | { type: 'page_open'; page: string }
    | { type: 'page_new' }
    | { type: 'page_duplicate'; page: string }
    | { type: 'page_rename'; page: string; title: string | null }
    | { type: 'page_delete'; page: string }
    | { type: 'page_summon'; page: string },
) => boolean;

/** An op with the page it was typed on ('' = a room without pages). */
interface PageOp {
  page: string;
  op: TextOp;
}

export type BoardEvent = 'local' | 'remote' | 'cursor' | 'load' | 'pages';

/** A short line the board shows for a few seconds ("Minghui brought you to page 7"). */
export interface BoardNotice {
  text: string;
  at: number;
}

export class TextBoardSession {
  /** One site per page load: "<user id>:<random>" (the room checks the prefix). */
  readonly site: string;
  doc: TextDoc;
  private unsent: PageOp[] = [];
  private sent: PageOp[] = [];
  private held: TextOp[] = [];
  /** The page on screen ('' until the room says, or from a room without pages). */
  page = '';
  pages: BoardPageMeta[] = [];
  /** Which page each other client looks at. */
  private views = new Map<string, string>();
  private peers = new Map<string, { name: string; userId: string }>();
  /** The user I follow (null = I turn pages myself). By user, not client: their reconnects keep it. */
  following: string | null = null;
  /** Waiting for the room's copy of the page just opened (the board is read-only meanwhile). */
  awaitingPage = false;
  notice: BoardNotice | null = null;
  private formerLabels = new Map<string, string>();
  /** A page_new / page_duplicate went out: the next page_doc for another page is that page. */
  private expectingNewPage = false;
  /** Documents of pages seen in this call (shown at once when flipping back; the room's copy replaces them). */
  private docCache = new Map<string, TextDoc>();
  private composing = false;
  private lastSel: TextSelection | null = null;
  private composeTimer: ReturnType<typeof setTimeout> | null = null;
  private composeSentAt = 0;
  private composeText: string | null = null;
  private cursors = new Map<string, RemoteCaret>();
  private listeners = new Set<(reason: BoardEvent) => void>();
  version = 0;

  constructor(userId: string, private send: Sender) {
    this.site = `${userId}:${Math.random().toString(36).slice(2, 8)}`;
    this.doc = new TextDoc(this.site);
  }

  subscribe(fn: (reason: BoardEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: BoardEvent) {
    this.version++;
    this.listeners.forEach((l) => l(reason));
  }

  get text(): string {
    return this.doc.text();
  }

  get remoteCarets(): RemoteCaret[] {
    return [...this.cursors.values()];
  }

  get isComposing(): boolean {
    return this.composing;
  }

  /**
   * The room's copy of the page on screen — on (re)join (welcome) and when a
   * page opens (page_doc). Edits made while the socket was down (or not yet
   * confirmed) are replayed on top and sent again — they're idempotent; those
   * typed on other pages go out again tagged with their page.
   */
  load(snapshot: TextDocSnapshot | undefined, cursors: TextCursor[] | undefined, page = this.page) {
    this.page = page;
    this.awaitingPage = false;
    this.doc = new TextDoc(this.site, snapshot ?? null);
    const replay = [...this.sent, ...this.unsent];
    this.sent = [];
    this.unsent = [];
    const known = new Set(this.pages.map((p) => p.id));
    // Only what the room hasn't got yet goes out again (for this page; other pages' edits are resent as they are).
    const missing = replay.filter((x) => (x.page === page ? this.doc.apply(x.op) : !x.page || known.has(x.page)));
    this.cursors.clear();
    for (const c of cursors ?? []) this.setCursor(c, false);
    this.push(missing);
    if (page) this.docCache.set(page, this.doc);
    this.emit('load');
  }

  /**
   * The room's welcome. First join: the opening page. A rejoin while I was on
   * another page that still exists: stay there (ask the room for it).
   */
  welcome(msg: { text?: TextDocSnapshot; text_cursors?: TextCursor[]; pages?: BoardPageMeta[]; page?: string; page_views?: Record<string, string> }) {
    this.pages = msg.pages ?? [];
    this.views = new Map(Object.entries(msg.page_views ?? {}));
    const stay = this.page && msg.page && this.page !== msg.page && this.pages.some((p) => p.id === this.page);
    if (stay) {
      // What I typed on other pages goes back now; this page's edits wait for its page_doc.
      const others = [...this.sent, ...this.unsent].filter((x) => x.page !== this.page);
      const mine = [...this.sent, ...this.unsent].filter((x) => x.page === this.page);
      this.sent = [];
      this.unsent = mine;
      this.push(others);
      this.awaitingPage = true;
      this.send({ type: 'page_open', page: this.page });
      this.emit('pages');
      return;
    }
    this.load(msg.text, msg.text_cursors, msg.page ?? '');
  }

  private push(ops: PageOp[]) {
    if (ops.length === 0) return;
    // Batches of ≤ 50 ops (the room's limit per message), one page per message.
    let i = 0;
    while (i < ops.length) {
      const page = ops[i].page;
      const batch: PageOp[] = [];
      while (i < ops.length && ops[i].page === page && batch.length < 50) batch.push(ops[i++]);
      const msg = page ? { type: 'text' as const, ops: batch.map((x) => x.op), page } : { type: 'text' as const, ops: batch.map((x) => x.op) };
      if (this.send(msg)) this.sent.push(...batch);
      else this.unsent.push(...batch);
    }
    // `sent` only matters until the next welcome; keep it bounded.
    if (this.sent.length > 2000) this.sent = this.sent.slice(-2000);
  }

  // ---- Pages ----

  /** The label of a page ("Page 7" or its title). */
  labelOf(pageId: string): string {
    const i = this.pages.findIndex((p) => p.id === pageId);
    return i < 0 ? 'a page' : pageLabel(i, this.pages[i].title);
  }

  /** Look at another page. Following stops unless the move IS the following. */
  openPage(pageId: string, opts: { follow?: boolean } = {}) {
    if (!opts.follow) this.following = null;
    if (pageId === this.page && !this.awaitingPage) {
      this.emit('pages');
      return;
    }
    if (this.page) this.docCache.set(this.page, this.doc);
    this.page = pageId;
    this.cursors.clear();
    this.held = [];
    const cached = this.docCache.get(pageId);
    this.doc = cached ?? new TextDoc(this.site);
    // A page seen before shows at once (and stays editable: the room's copy merges in);
    // a new one waits for the room's copy.
    this.awaitingPage = !cached;
    this.send({ type: 'page_open', page: pageId });
    this.emit('load');
  }

  newPage() {
    this.following = null;
    if (this.send({ type: 'page_new' })) this.expectingNewPage = true;
  }

  duplicatePage(pageId: string) {
    this.following = null;
    if (this.send({ type: 'page_duplicate', page: pageId })) this.expectingNewPage = true;
  }

  renamePage(pageId: string, title: string | null) {
    this.send({ type: 'page_rename', page: pageId, title });
  }

  deletePage(pageId: string) {
    this.send({ type: 'page_delete', page: pageId });
  }

  /** "Bring <name> here". */
  summon() {
    if (this.page) this.send({ type: 'page_summon', page: this.page });
  }

  follow(userId: string | null) {
    this.following = userId;
    const theirs = userId ? this.others.find((o) => o.userId === userId)?.page : undefined;
    if (theirs && theirs !== this.page) this.openPage(theirs, { follow: true });
    else this.emit('pages');
  }

  /** The other people and the page each is on. */
  get others(): { clientId: string; name: string; userId: string; color: string; page: string }[] {
    return [...this.peers.entries()].map(([clientId, p]) => ({
      clientId,
      name: p.name,
      userId: p.userId,
      color: presenceColor(p.userId),
      page: this.views.get(clientId) ?? '',
    }));
  }

  /** The call's other people (their client ids change on every reconnect). */
  resetPeers(peers: { client_id: string; name: string; user_id: string }[]) {
    this.peers = new Map(peers.map((p) => [p.client_id, { name: p.name, userId: p.user_id }]));
  }

  setPeer(clientId: string, name: string, userId: string, page?: string) {
    this.peers.set(clientId, { name, userId });
    if (page) this.views.set(clientId, page);
    this.emit('pages');
  }

  dropPeer(clientId: string) {
    this.peers.delete(clientId);
    this.views.delete(clientId);
    this.dropCursor(clientId);
    this.emit('pages');
  }

  /** Room: the page list changed. */
  setPages(pages: BoardPageMeta[]) {
    // Labels as they were: a page_deleted follows the list it is already missing from.
    this.pages.forEach((p, i) => this.formerLabels.set(p.id, pageLabel(i, p.title)));
    this.pages = pages;
    this.emit('pages');
  }

  /** Room: the page I asked for. A late answer for a page I have already left is only remembered. */
  pageDoc(page: string, snapshot: TextDocSnapshot, cursors: TextCursor[]) {
    // The page I just made (new / duplicate): the room opens it for me.
    if (this.expectingNewPage && page !== this.page) {
      this.expectingNewPage = false;
      if (this.page) this.docCache.set(this.page, this.doc);
      this.cursors.clear();
      this.held = [];
      this.load(snapshot, cursors, page);
      return;
    }
    if (page !== this.page) {
      this.docCache.set(page, new TextDoc(this.site, snapshot));
      return;
    }
    this.load(snapshot, cursors, page);
  }

  /** Room: someone now looks at `page`. */
  pageView(clientId: string, page: string) {
    this.views.set(clientId, page);
    if (page !== this.page) this.cursors.delete(clientId);
    if (this.following && this.peers.get(clientId)?.userId === this.following && page !== this.page) {
      this.openPage(page, { follow: true });
      return;
    }
    this.emit('pages');
  }

  pagePreview(page: string, preview: string, chars: number, updatedAt: number) {
    const p = this.pages.find((x) => x.id === page);
    if (!p) return;
    p.preview = preview;
    p.chars = chars;
    p.updated_at = updatedAt;
    this.emit('pages');
  }

  /** Room: `page` was deleted (the new list, without it, came just before). */
  pageDeleted(page: string, fallback: string, by: string) {
    const label = (this.formerLabels.get(page) ?? 'a page').replace(/^Page/, 'page');
    this.docCache.delete(page);
    for (const [c, v] of this.views) if (v === page) this.views.set(c, fallback);
    if (this.page === page) {
      this.openPage(fallback, { follow: this.following !== null });
      this.say(`${by} deleted ${label}`);
    } else this.emit('pages');
  }

  /** Room: the other person brought me to their page. */
  summoned(name: string, page: string) {
    if (!this.pages.some((p) => p.id === page)) return;
    if (page !== this.page) this.openPage(page, { follow: this.following !== null });
    this.say(`${name} brought you to ${this.labelOf(page).replace(/^Page/, 'page')}`);
  }

  /** A line for the board (e.g. the room refusing something). */
  notify(text: string) {
    this.say(text);
  }

  private say(text: string) {
    this.notice = { text, at: Date.now() };
    this.emit('pages');
  }

  /** The textarea now says `next` (after an input event outside a composition). */
  localEdit(next: string, caret?: number) {
    if (this.composing) return;
    const ops = this.doc.replaceText(next, caret);
    if (ops.length === 0) return;
    this.push(ops.map((op) => ({ page: this.page, op })));
    this.emit('local');
  }

  applyRemote(ops: TextOp[], page?: string) {
    // Keystrokes for a page I'm not on (a late message after flipping) are left to that page's page_doc.
    if (page !== undefined && page !== this.page) return;
    if (this.composing) {
      this.held.push(...ops);
      return;
    }
    let changed = false;
    for (const op of ops) changed = this.doc.apply(op) || changed;
    if (changed) this.emit('remote');
  }

  /**
   * compositionstart → true. compositionend → false with the textarea's final
   * value: my composed text goes out (typed against the text I had); then call
   * flushHeld() for what arrived meanwhile.
   */
  setComposing(on: boolean, finalText?: string, caret?: number) {
    if (on) {
      this.composing = true;
      return;
    }
    this.composing = false;
    this.cancelCompose(); // the committed text itself goes out next
    if (finalText !== undefined) this.localEdit(finalText, caret);
  }

  /** Apply the other person's edits that waited for a composition to end. */
  flushHeld() {
    const held = this.held;
    this.held = [];
    if (held.length) this.applyRemote(held);
  }

  /** My caret / selection as character indexes → sent as anchors. */
  sendSelection(start: number, end: number, backwards = false) {
    // Mid-composition the caret moves over uncommitted text: the composition preview says where I am.
    if (this.composing) return;
    const a = this.doc.anchorAt(backwards ? end : start);
    const h = this.doc.anchorAt(backwards ? start : end);
    this.lastSel = { anchor: a, head: h };
    this.cancelCompose();
    this.send({ type: 'text_cursor', sel: this.lastSel, ...this.pageField() });
  }

  private pageField(): { page?: string } {
    return this.page ? { page: this.page } : {};
  }

  clearSelection() {
    this.lastSel = null;
    this.cancelCompose();
    this.send({ type: 'text_cursor', sel: null, ...this.pageField() });
  }

  /**
   * What I'm composing in the IME right now (compositionupdate), so the other
   * person sees my typing before I commit it. ≤ ~12 messages a second, latest wins.
   * The selection that goes with it is where the composition started.
   */
  sendComposing(text: string, caretIndex: number) {
    if (!this.lastSel || this.composeText === null) {
      const anchor = this.doc.anchorAt(caretIndex);
      this.lastSel = { anchor, head: anchor };
    }
    this.composeText = text;
    const flush = () => {
      this.composeTimer = null;
      this.composeSentAt = Date.now();
      if (this.composeText !== null) this.send({ type: 'text_cursor', sel: this.lastSel, compose: this.composeText || null, ...this.pageField() });
    };
    if (this.composeTimer) return;
    const wait = 80 - (Date.now() - this.composeSentAt);
    if (wait <= 0) flush();
    else this.composeTimer = setTimeout(flush, wait);
  }

  private cancelCompose() {
    if (this.composeTimer) clearTimeout(this.composeTimer);
    this.composeTimer = null;
    this.composeText = null;
  }

  setCursor(c: TextCursor & { page?: string }, emit = true) {
    if (c.page !== undefined && c.page !== this.page) return;
    if (!c.sel) this.cursors.delete(c.client_id);
    else this.cursors.set(c.client_id, { clientId: c.client_id, userId: c.user_id, name: c.name, color: presenceColor(c.user_id), sel: c.sel, compose: c.compose ?? null });
    if (emit) this.emit('cursor');
  }

  dropCursor(clientId: string) {
    if (this.cursors.delete(clientId)) this.emit('cursor');
  }

  /** Character index of an anchor in the current text. */
  indexOf(anchor: CharId | null): number {
    return this.doc.indexOfAnchor(anchor);
  }

  anchorAt(index: number): CharId | null {
    return this.doc.anchorAt(index);
  }
}
