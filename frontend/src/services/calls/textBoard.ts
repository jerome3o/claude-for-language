/**
 * The shared text board's client side: this page's replica of the document
 * (shared/calls/textDoc.ts), the edits not yet accepted by the room, the other
 * person's caret, and the IME rule — while a Chinese pinyin composition is in
 * progress nothing is sent and the other person's edits wait, so the
 * composition window is never disturbed; both catch up on compositionend.
 */

import {
  TextDoc,
  presenceColor,
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

type Sender = (msg: { type: 'text'; ops: TextOp[] } | { type: 'text_cursor'; sel: TextSelection | null; compose?: string | null }) => boolean;

export class TextBoardSession {
  /** One site per page load: "<user id>:<random>" (the room checks the prefix). */
  readonly site: string;
  doc: TextDoc;
  private unsent: TextOp[] = [];
  private sent: TextOp[] = [];
  private held: TextOp[] = [];
  private composing = false;
  private lastSel: TextSelection | null = null;
  private composeTimer: ReturnType<typeof setTimeout> | null = null;
  private composeSentAt = 0;
  private composeText: string | null = null;
  private cursors = new Map<string, RemoteCaret>();
  private listeners = new Set<(reason: 'local' | 'remote' | 'cursor' | 'load') => void>();
  version = 0;

  constructor(userId: string, private send: Sender) {
    this.site = `${userId}:${Math.random().toString(36).slice(2, 8)}`;
    this.doc = new TextDoc(this.site);
  }

  subscribe(fn: (reason: 'local' | 'remote' | 'cursor' | 'load') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: 'local' | 'remote' | 'cursor' | 'load') {
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
   * The room's copy on (re)join. Edits made while the socket was down (or not
   * yet confirmed) are replayed on top and sent again — they're idempotent.
   */
  load(snapshot: TextDocSnapshot | undefined, cursors: TextCursor[] | undefined) {
    this.doc = new TextDoc(this.site, snapshot ?? null);
    const replay = [...this.sent, ...this.unsent];
    this.sent = [];
    this.unsent = [];
    // Only what the room hasn't got yet goes out again.
    const missing = replay.filter((op) => this.doc.apply(op));
    this.cursors.clear();
    for (const c of cursors ?? []) this.setCursor(c, false);
    this.push(missing);
    this.emit('load');
  }

  private push(ops: TextOp[]) {
    if (ops.length === 0) return;
    // Batches of ≤ 50 ops (the room's limit per message).
    for (let i = 0; i < ops.length; i += 50) {
      const batch = ops.slice(i, i + 50);
      if (this.send({ type: 'text', ops: batch })) this.sent.push(...batch);
      else this.unsent.push(...batch);
    }
    // `sent` only matters until the next welcome; keep it bounded.
    if (this.sent.length > 2000) this.sent = this.sent.slice(-2000);
  }

  /** The textarea now says `next` (after an input event outside a composition). */
  localEdit(next: string, caret?: number) {
    if (this.composing) return;
    const ops = this.doc.replaceText(next, caret);
    if (ops.length === 0) return;
    this.push(ops);
    this.emit('local');
  }

  applyRemote(ops: TextOp[]) {
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
    this.send({ type: 'text_cursor', sel: this.lastSel });
  }

  clearSelection() {
    this.lastSel = null;
    this.cancelCompose();
    this.send({ type: 'text_cursor', sel: null });
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
      if (this.composeText !== null) this.send({ type: 'text_cursor', sel: this.lastSel, compose: this.composeText || null });
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

  setCursor(c: TextCursor, emit = true) {
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
