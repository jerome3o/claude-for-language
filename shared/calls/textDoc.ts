/**
 * The call's shared text board: one plain-text document both people type into
 * at once. A small sequence CRDT (RGA — Replicated Growable Array), so edits
 * made at the same moment on two sides merge the same way everywhere, with no
 * server-side transform:
 *
 *  - every character has a unique id `[counter, site]` (a Lamport counter and
 *    the writer's connection id) and remembers the character it was typed
 *    after; a deleted character stays as a tombstone so later edits can still
 *    point at it;
 *  - concurrent inserts after the same character are ordered by id (higher
 *    first), which makes every replica reach the same order;
 *  - the CallRoom Durable Object relays ops in the order it receives them (so
 *    an op always arrives after the ones it depends on), keeps the document,
 *    and hands it to whoever joins.
 *
 * Carets and selections travel as ids too (`anchor` = the character just
 * before the caret, null = start), so they stay put while the other person
 * types above them. The Lab app's CallTextDoc.kt is a port, parity-tested.
 */

export type CharId = [number, string];

/** `text` typed after `after` (null = at the start); its characters get ids id, id+1, … on the same site. */
export interface TextInsertOp {
  t: 'ins';
  id: CharId;
  after: CharId | null;
  text: string;
}

export interface TextDeleteOp {
  t: 'del';
  ids: CharId[];
}

export type TextOp = TextInsertOp | TextDeleteOp;

/** A run of characters with consecutive ids from one site: [counter, site, text, deleted 0|1]. */
export type TextRun = [number, string, string, 0 | 1];

export interface TextDocSnapshot {
  v: 1;
  runs: TextRun[];
}

/** Visible characters a board may hold (≈ several pages of lesson notes). */
export const MAX_TEXT_DOC_CHARS = 20_000;
/** Characters incl. tombstones; past this the room refuses inserts (a lesson never gets near it). */
export const MAX_TEXT_DOC_NODES = 80_000;
/** One insert op carries at most this much text (a paste). */
export const MAX_TEXT_OP_CHARS = 5_000;
export const MAX_TEXT_OP_DELETES = 5_000;

interface Node {
  c: number;
  s: string;
  ch: string;
  del: boolean;
}

const key = (c: number, s: string) => `${c}@${s}`;

/** RGA order between two ids: >0 when a wins (goes first). */
export function compareIds(ac: number, as: string, bc: number, bs: string): number {
  if (ac !== bc) return ac - bc;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Split into user-perceived characters? No — UTF-16 code points, so a surrogate pair is one character (IME emoji stay whole). */
export function splitChars(text: string): string[] {
  return Array.from(text);
}

export class TextDoc {
  readonly site: string;
  private nodes: Node[] = [];
  private byKey = new Map<string, Node>();
  private pending: TextOp[] = [];
  private clockValue = 0;

  constructor(site: string, snapshot?: TextDocSnapshot | null) {
    this.site = site;
    if (snapshot) this.load(snapshot);
  }

  /** The highest counter seen: the next local character gets clock + 1. */
  get clock(): number {
    return this.clockValue;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  text(): string {
    let out = '';
    for (const n of this.nodes) if (!n.del) out += n.ch;
    return out;
  }

  /** Visible length in characters (code points). */
  get length(): number {
    let n = 0;
    for (const x of this.nodes) if (!x.del) n++;
    return n;
  }

  private load(snap: TextDocSnapshot) {
    this.nodes = [];
    this.byKey.clear();
    for (const [c, s, text, del] of snap.runs) {
      splitChars(text).forEach((ch, i) => {
        const node: Node = { c: c + i, s, ch, del: del === 1 };
        this.nodes.push(node);
        this.byKey.set(key(node.c, node.s), node);
        if (node.c > this.clockValue) this.clockValue = node.c;
      });
    }
  }

  snapshot(): TextDocSnapshot {
    const runs: TextRun[] = [];
    let cur: TextRun | null = null;
    let next = 0;
    for (const n of this.nodes) {
      const d: 0 | 1 = n.del ? 1 : 0;
      if (cur && cur[1] === n.s && cur[3] === d && n.c === next) {
        cur[2] += n.ch;
      } else {
        cur = [n.c, n.s, n.ch, d];
        runs.push(cur);
      }
      next = n.c + 1;
    }
    return { v: 1, runs };
  }

  has(id: CharId | null): boolean {
    return id === null || this.byKey.has(key(id[0], id[1]));
  }

  private indexOfNode(node: Node): number {
    return this.nodes.indexOf(node);
  }

  private integrateChar(c: number, s: string, ch: string, after: CharId | null): void {
    if (this.byKey.has(key(c, s))) return; // already here (a replay)
    let i = 0;
    if (after) {
      const parent = this.byKey.get(key(after[0], after[1]))!;
      i = this.indexOfNode(parent) + 1;
    }
    // Skip the characters that win against this one: concurrent inserts after the same
    // parent with a higher id, and everything typed after them (their ids are higher still).
    while (i < this.nodes.length && compareIds(this.nodes[i].c, this.nodes[i].s, c, s) > 0) i++;
    const node: Node = { c, s, ch, del: false };
    this.nodes.splice(i, 0, node);
    this.byKey.set(key(c, s), node);
    if (c > this.clockValue) this.clockValue = c;
  }

  private canApply(op: TextOp): boolean {
    return op.t === 'ins' ? this.has(op.after) : op.ids.every((id) => this.has(id));
  }

  private applyNow(op: TextOp): boolean {
    if (op.t === 'ins') {
      let after = op.after;
      let changed = false;
      splitChars(op.text).forEach((ch, i) => {
        const c = op.id[0] + i;
        if (!this.byKey.has(key(c, op.id[1]))) changed = true;
        this.integrateChar(c, op.id[1], ch, after);
        after = [c, op.id[1]];
      });
      return changed;
    }
    let changed = false;
    for (const [c, s] of op.ids) {
      const n = this.byKey.get(key(c, s));
      if (n && !n.del) {
        n.del = true;
        changed = true;
      }
      if (c > this.clockValue) this.clockValue = c;
    }
    return changed;
  }

  /**
   * Apply an op from anyone (idempotent). An op whose characters aren't here
   * yet waits until they are. Returns true when the text changed.
   */
  apply(op: TextOp): boolean {
    if (!this.canApply(op)) {
      this.pending.push(op);
      return false;
    }
    let changed = this.applyNow(op);
    // Anything that was waiting for this.
    let progress = true;
    while (progress && this.pending.length) {
      progress = false;
      for (let k = 0; k < this.pending.length; k++) {
        if (this.canApply(this.pending[k])) {
          const [p] = this.pending.splice(k, 1);
          changed = this.applyNow(p) || changed;
          progress = true;
          break;
        }
      }
    }
    return changed;
  }

  /** Node index of the `index`-th visible character (index = length → nodes.length). */
  private nodeIndexOfVisible(index: number): number {
    let seen = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].del) continue;
      if (seen === index) return i;
      seen++;
    }
    return this.nodes.length;
  }

  /** The id of the visible character just before `index` (null = the start). */
  anchorAt(index: number): CharId | null {
    if (index <= 0) return null;
    let seen = 0;
    for (const n of this.nodes) {
      if (n.del) continue;
      seen++;
      if (seen === index) return [n.c, n.s];
    }
    // Past the end: the last visible character.
    for (let i = this.nodes.length - 1; i >= 0; i--) if (!this.nodes[i].del) return [this.nodes[i].c, this.nodes[i].s];
    return null;
  }

  /** The caret position just after `anchor` (a deleted anchor: after its nearest visible predecessor). */
  indexOfAnchor(anchor: CharId | null): number {
    if (!anchor) return 0;
    const node = this.byKey.get(key(anchor[0], anchor[1]));
    if (!node) return 0;
    let visible = 0;
    for (const n of this.nodes) {
      if (!n.del) visible++;
      if (n === node) return n.del ? visible : visible;
    }
    return visible;
  }

  /** Type `text` at visible `index`. Returns the op to send (already applied here). */
  localInsert(index: number, text: string): TextInsertOp | null {
    if (!text) return null;
    const after = this.anchorAt(Math.min(index, this.length));
    const op: TextInsertOp = { t: 'ins', id: [this.clockValue + 1, this.site], after, text };
    this.applyNow(op);
    return op;
  }

  /** Delete `count` visible characters from `index`. Returns the op to send (already applied here). */
  localDelete(index: number, count: number): TextDeleteOp | null {
    if (count <= 0) return null;
    const ids: CharId[] = [];
    let i = this.nodeIndexOfVisible(index);
    while (i < this.nodes.length && ids.length < count) {
      const n = this.nodes[i];
      if (!n.del) ids.push([n.c, n.s]);
      i++;
    }
    if (ids.length === 0) return null;
    const op: TextDeleteOp = { t: 'del', ids };
    this.applyNow(op);
    return op;
  }

  /**
   * Turn "the text is now `next`" (what a textarea says after an edit) into
   * ops: one delete of the changed middle and one insert of the new middle.
   * `caret` (the caret after the edit) settles which copy of a repeated
   * character was typed.
   */
  replaceText(next: string, caret?: number): TextOp[] {
    const prev = splitChars(this.text());
    const want = splitChars(next);
    const edit = diffChars(prev, want, caret === undefined ? undefined : codeUnitToCharIndex(next, caret));
    const ops: TextOp[] = [];
    const del = this.localDelete(edit.index, edit.remove);
    if (del) ops.push(del);
    const ins = this.localInsert(edit.index, edit.insert);
    if (ins) ops.push(ins);
    return ops;
  }
}

/** A UTF-16 offset (textarea selectionStart) → a character (code point) index. */
export function codeUnitToCharIndex(text: string, offset: number): number {
  return Array.from(text.slice(0, Math.max(0, offset))).length;
}

/** A character index → a UTF-16 offset. */
export function charToCodeUnitIndex(text: string, index: number): number {
  const chars = Array.from(text);
  let off = 0;
  for (let i = 0; i < Math.min(index, chars.length); i++) off += chars[i].length;
  return off;
}

/**
 * The single edit that turns `prev` into `next`: common prefix / suffix,
 * the middle replaced. With `caret` (a character index in `next`), the edit
 * ends at the caret when that's consistent — typing "a" into "aa" at the
 * start inserts at 0, not at 2.
 */
export function diffChars(prev: string[], next: string[], caret?: number): { index: number; remove: number; insert: string } {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (caret !== undefined && caret >= 0 && caret <= next.length) {
    // Slide a pure insert / delete so it ends at the caret (the edit is ambiguous inside a run of equal characters).
    const inserted = endNext - start;
    const removed = endPrev - start;
    if (removed === 0 && inserted > 0 && caret < endNext && caret - inserted >= 0) {
      const s = caret - inserted;
      if (next.slice(0, s).join('') === prev.slice(0, s).join('') && next.slice(caret).join('') === prev.slice(s).join('')) {
        return { index: s, remove: 0, insert: next.slice(s, caret).join('') };
      }
    }
    if (inserted === 0 && removed > 0 && caret < start) {
      const s = caret;
      if (prev.slice(0, s).join('') === next.slice(0, s).join('') && prev.slice(s + removed).join('') === next.slice(s).join('')) {
        return { index: s, remove: removed, insert: '' };
      }
    }
  }
  return { index: start, remove: endPrev - start, insert: next.slice(start, endNext).join('') };
}

// ---------------------------------------------------------------- wire validation

function isCharId(v: unknown): v is CharId {
  return Array.isArray(v) && v.length === 2 && Number.isSafeInteger(v[0]) && v[0] > 0 && typeof v[1] === 'string' && v[1].length > 0 && v[1].length <= 64;
}

/** Validate an op off the wire (the room never stores junk). Inserts must come from the sender's own site. */
export function sanitizeTextOp(raw: unknown, site?: string): TextOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw as Record<string, unknown>;
  if (op.t === 'ins') {
    if (!isCharId(op.id) || (op.after !== null && !isCharId(op.after)) || typeof op.text !== 'string') return null;
    if (!op.text || op.text.length > MAX_TEXT_OP_CHARS) return null;
    if (site !== undefined && op.id[1] !== site) return null;
    // A character's counter is always above the one it was typed after (the order relies on it).
    if (op.after !== null && (op.after as CharId)[0] >= op.id[0]) return null;
    return { t: 'ins', id: [op.id[0], op.id[1]], after: op.after === null ? null : [(op.after as CharId)[0], (op.after as CharId)[1]], text: op.text };
  }
  if (op.t === 'del') {
    if (!Array.isArray(op.ids) || op.ids.length === 0 || op.ids.length > MAX_TEXT_OP_DELETES) return null;
    if (!op.ids.every(isCharId)) return null;
    return { t: 'del', ids: (op.ids as CharId[]).map(([c, s]) => [c, s] as CharId) };
  }
  return null;
}

export function sanitizeTextSnapshot(raw: unknown): TextDocSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const runs = (raw as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return null;
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!Array.isArray(r) || r.length !== 4) return null;
    const [c, s, text, d] = r;
    if (!Number.isSafeInteger(c) || c <= 0 || typeof s !== 'string' || typeof text !== 'string' || (d !== 0 && d !== 1)) return null;
    out.push([c, s, text, d]);
  }
  return { v: 1, runs: out };
}

/** The text of a snapshot (what the review page and the homework agent read). */
export function snapshotText(snap: TextDocSnapshot | null | undefined): string {
  if (!snap) return '';
  return snap.runs.filter((r) => r[3] === 0).map((r) => r[2]).join('');
}

/** A caret / selection on the shared text: both ends as anchors (null = the start). */
export interface TextSelection {
  anchor: CharId | null;
  head: CharId | null;
}

export function sanitizeSelection(raw: unknown): TextSelection | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const ok = (v: unknown) => v === null || isCharId(v);
  if (!ok(s.anchor) || !ok(s.head)) return null;
  return { anchor: (s.anchor as CharId | null) ?? null, head: (s.head as CharId | null) ?? null };
}

/** A person's colour on the board (their caret, selection and name flag), stable per user id. */
export const PRESENCE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'] as const;

export function presenceColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length];
}
