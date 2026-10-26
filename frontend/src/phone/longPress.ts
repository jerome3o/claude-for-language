/**
 * Long-press any text in the simulated phone → the language explorer with the word under the
 * finger (docs/PHONE_PRACTICE.md "Learning aids"). One handler on the phone's display, so every
 * app's text works without wrapping strings: the press point → the text node + offset
 * (caretPositionFromPoint / caretRangeFromPoint) → the device segmenter's word at that offset
 * (shared/chinese/segment.ts; one character until the word lists are loaded). A press on an
 * input, or a short tap, does nothing special; the click after a long press is swallowed.
 */
import { useEffect, useRef } from 'react';
import { itemForText, type ExplorerItem } from '@shared/explorer';
import { loadSegmenter, segmentNow } from '../services/chineseSegmenter';

export const LONG_PRESS_MS = 520;
const MOVE_PX = 10;
const HAN = /[㐀-鿿]/;

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export function textAtPoint(x: number, y: number): { text: string; offset: number } | null {
  const d = document as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (d.caretPositionFromPoint) {
    const pos = d.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  return text ? { text, offset } : null;
}

/** The explorer item for the word at `offset` of `text` (pure given the segments). */
export function itemAt(text: string, offset: number, segments: Array<{ text: string; pinyin?: string; gloss?: string }> | null): ExplorerItem | null {
  // The caret may sit just after the character pressed: prefer the character at offset, else before it.
  const at = HAN.test(text.charAt(offset)) ? offset : HAN.test(text.charAt(offset - 1)) ? offset - 1 : -1;
  if (at < 0) return null;
  if (segments) {
    let pos = 0;
    for (const s of segments) {
      const end = pos + s.text.length;
      if (at >= pos && at < end) {
        return itemForText(s.text, { pinyin: s.pinyin || undefined, gloss: s.gloss || undefined, sentence: text.length <= 80 ? text : undefined });
      }
      pos = end;
    }
  }
  return itemForText(text.charAt(at), { sentence: text.length <= 80 ? text : undefined });
}

/** Wire long-press on `ref` (the phone display) to `onWord`. */
export function useLongPressWords(ref: React.RefObject<HTMLElement>, onWord: (item: ExplorerItem) => void) {
  const cb = useRef(onWord);
  cb.current = onWord;
  useEffect(() => {
    void loadSegmenter();
    const el = ref.current;
    if (!el) return;
    let timer: number | null = null;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
      start = null;
    };
    const down = (e: PointerEvent) => {
      fired = false;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [data-no-explore]')) return;
      start = { x: e.clientX, y: e.clientY };
      const { clientX, clientY } = e;
      timer = window.setTimeout(() => {
        timer = null;
        const hit = textAtPoint(clientX, clientY);
        if (!hit) return;
        const item = itemAt(hit.text, hit.offset, segmentNow(hit.text));
        if (!item) return;
        fired = true;
        cb.current(item);
      }, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) clear();
    };
    const click = (e: MouseEvent) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    };
    const menu = (e: Event) => {
      // No browser menu on a long press inside the phone (text there is never selectable).
      if (!(e.target as HTMLElement | null)?.closest('input, textarea')) e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('click', click, true);
    el.addEventListener('contextmenu', menu);
    return () => {
      clear();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', clear);
      el.removeEventListener('pointercancel', clear);
      el.removeEventListener('click', click, true);
      el.removeEventListener('contextmenu', menu);
    };
  }, [ref]);
}
