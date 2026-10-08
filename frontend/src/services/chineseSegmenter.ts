/**
 * Word chips without an LLM (docs/LANGUAGE_EXPLORER.md "Word chips without an LLM"): the
 * deterministic segmenter (shared/chinese/segment.ts) over the two word lists the app ships —
 * shared/data/frequency/word-freq.txt and segment-words.txt — loaded ONCE per page from lazily
 * imported chunks (precached by the service worker, so it works offline), with pinyin from the
 * app's own auto-pinyin (pinyin-pro + the 一 / 不 tone changes) over each run of characters.
 *
 * Used for Ask Claude's bubbles (always), and for chat messages and reader pages while their
 * Claude-made words are missing or failed. Lab app: core/…/chinese/Segmenter.kt (parity-tested).
 */
import { useEffect, useState } from 'react';
import { parseFrequencyList } from '@shared/decks/frequency';
import { buildSegmentDictionary, parseSegmentWords, segmentChinese, type SegmentDictionary } from '@shared/chinese/segment';
import type { ReaderWord } from '@shared/reader/words';
import { autoPinyin } from '../utils/autoPinyin';

let dict: SegmentDictionary | null = null;
let loading: Promise<SegmentDictionary | null> | null = null;

/** Load the word lists (once); null when the chunks can't be had (tried again next time). */
export function loadSegmenter(): Promise<SegmentDictionary | null> {
  if (dict) return Promise.resolve(dict);
  if (!loading) {
    loading = Promise.all([
      import('@shared/data/frequency/word-freq.txt?raw'),
      import('@shared/data/frequency/segment-words.txt?raw'),
    ])
      .then(([freq, extra]) => {
        dict = buildSegmentDictionary(parseFrequencyList(freq.default).words, parseSegmentWords(extra.default));
        return dict;
      })
      .catch((err) => {
        console.warn('[segmenter] word lists unavailable', err);
        loading = null;
        return null;
      });
  }
  return loading;
}

/**
 * Start loading the lists in the background (idle time), so the first bubble already has its
 * word chips. Called when a module that shows word chips is loaded; skipped under tests.
 */
export function preloadSegmenter(): void {
  if (dict || loading || typeof window === 'undefined' || import.meta.env.MODE === 'test') return;
  const start = () => void loadSegmenter();
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(start, { timeout: 3000 });
  else window.setTimeout(start, 1000);
}

/** The dictionary if it is already loaded (no waiting). */
export function segmenterReady(): SegmentDictionary | null {
  return dict;
}

function runPinyin(run: string): string {
  return autoPinyin(run);
}

const cache = new Map<string, ReaderWord[]>();
const CACHE_MAX = 400;

/** The text as word segments (with pinyin), or null while the word lists aren't loaded. */
export function segmentNow(text: string): ReaderWord[] | null {
  if (!dict || !text) return null;
  const hit = cache.get(text);
  if (hit) return hit;
  const words = segmentChinese(text, dict, { pinyinOf: runPinyin });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(text, words);
  return words;
}

/**
 * Word segments of `text` for a component: at once when the lists are loaded (they usually
 * are — `loadSegmenter()` runs as the study page and chat open), else after they load. Null
 * when `enabled` is false, the text is empty or the lists can't be loaded.
 */
export function useSegmentedWords(text: string, enabled = true): ReaderWord[] | null {
  const [ready, setReady] = useState<SegmentDictionary | null>(dict);
  useEffect(() => {
    if (!enabled || ready) return;
    let cancelled = false;
    void loadSegmenter().then((d) => {
      if (!cancelled && d) setReady(d);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);
  return enabled && ready ? segmentNow(text) : null;
}

/** Tests: forget the loaded lists. */
export function resetSegmenterForTests(): void {
  dict = null;
  loading = null;
  cache.clear();
}
