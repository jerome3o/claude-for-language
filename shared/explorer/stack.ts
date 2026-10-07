/**
 * The language explorer's navigation stack (docs/LANGUAGE_EXPLORER.md): a stack of views —
 * a Character view or a Word view — that the learner pushes by tapping Chinese inside a
 * view, pops with ← or the breadcrumb, and closes with ✕. Pure; the Lab app's port
 * (core/…/explorer/ExplorerStack.kt) is parity-tested against this file.
 */
import { isHanCodePoint } from '../progress/known';

export interface CharItem {
  kind: 'char';
  char: string;
}

export interface WordItem {
  kind: 'word';
  hanzi: string;
  /** What the place it was tapped in already knows (a reader word chip, a breakdown row). */
  pinyin?: string;
  gloss?: string;
  /** The sentence it was tapped in ("More about this word" explains it there). */
  sentence?: string;
}

export type ExplorerItem = CharItem | WordItem;

/** Deepest the stack gets; pushing more drops the oldest views. */
export const EXPLORER_MAX_DEPTH = 24;

export type ExplorerAction =
  | { type: 'open'; item: ExplorerItem }
  | { type: 'push'; item: ExplorerItem }
  | { type: 'pop' }
  | { type: 'popTo'; index: number }
  | { type: 'close' };

/** The Han characters of a text, in order. */
export function hanOnly(text: string): string {
  let out = '';
  for (const ch of text) if (isHanCodePoint(ch.codePointAt(0)!)) out += ch;
  return out;
}

/**
 * The view for a tapped piece of text: one Han character → the Character view, several →
 * the Word view (punctuation and spaces dropped), none → null (nothing to explore).
 */
export function itemForText(text: string, hint: Omit<WordItem, 'kind' | 'hanzi'> = {}): ExplorerItem | null {
  const han = hanOnly(text);
  const n = [...han].length;
  if (n === 0) return null;
  if (n === 1) return { kind: 'char', char: han };
  const item: WordItem = { kind: 'word', hanzi: han };
  if (hint.pinyin) item.pinyin = hint.pinyin;
  if (hint.gloss) item.gloss = hint.gloss;
  if (hint.sentence) item.sentence = hint.sentence;
  return item;
}

/** Identity of a view: the same character / word is the same view whatever hint it carries. */
export function itemKey(item: ExplorerItem): string {
  return item.kind === 'char' ? `c:${item.char}` : `w:${item.hanzi}`;
}

export function itemLabel(item: ExplorerItem): string {
  return item.kind === 'char' ? item.char : item.hanzi;
}

/**
 * - open: a fresh stack with this one view;
 * - push: the item on top — unless it is already the top (no-op), or already further down
 *   the trail, in which case the stack goes back to it (银行 › 银 › 银行 = back to 银行);
 * - pop: one back (an empty stack = closed);
 * - popTo: back to that breadcrumb (index into the stack);
 * - close: empty.
 */
export function explorerReducer(stack: readonly ExplorerItem[], action: ExplorerAction): ExplorerItem[] {
  switch (action.type) {
    case 'open':
      return [action.item];
    case 'push': {
      const key = itemKey(action.item);
      const at = stack.findIndex((it) => itemKey(it) === key);
      if (at >= 0) return stack.slice(0, at + 1);
      const next = [...stack, action.item];
      return next.length > EXPLORER_MAX_DEPTH ? next.slice(next.length - EXPLORER_MAX_DEPTH) : next;
    }
    case 'pop':
      return stack.slice(0, -1);
    case 'popTo':
      return action.index >= 0 && action.index < stack.length ? stack.slice(0, action.index + 1) : [...stack];
    case 'close':
      return [];
  }
}

export type Crumb = { kind: 'item'; label: string; index: number; current: boolean } | { kind: 'gap' };

/**
 * The compact trail: every view while it fits (`max`), else the first, a gap (…) and the
 * last `max - 2` — the current view is always the last crumb.
 */
export function breadcrumbTrail(stack: readonly ExplorerItem[], max = 4): Crumb[] {
  const crumb = (i: number): Crumb => ({ kind: 'item', label: itemLabel(stack[i]), index: i, current: i === stack.length - 1 });
  if (stack.length <= max) return stack.map((_, i) => crumb(i));
  const tail = Math.max(1, max - 2);
  return [crumb(0), { kind: 'gap' }, ...stack.slice(stack.length - tail).map((_, j) => crumb(stack.length - tail + j))];
}
