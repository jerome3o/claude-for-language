/**
 * "Example sentence style" on this device (shared/study/sentenceStyle.ts; docs/STUDY_SESSION.md "Example sentence
 * style"): the account's register for NEW example sentences (`users.sentence_style`, NULL = everyday;
 * `/api/auth/me` and `/api/sync/changes` carry it as `sentence_style`, `PUT /api/profile/sentence-style` changes it),
 * mirrored to localStorage so Settings shows it offline. Nothing on the device writes sentences — the worker's
 * generator reads the account's value — so this cache is only for the Settings control.
 */
import { DEFAULT_SENTENCE_STYLE, sentenceStyleOf, type SentenceStyle } from '@shared/study/sentenceStyle';

const KEY = 'sentence-style-v1';
/** Fired on window when the cached style changed. */
export const SENTENCE_STYLE_CHANGED = 'sentence-style-changed';

/** The style in effect (the default until the server says). */
export function readSentenceStyle(): SentenceStyle {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return sentenceStyleOf(raw);
  } catch { /* storage unavailable */ }
  return DEFAULT_SENTENCE_STYLE;
}

/**
 * Store the server's value: a style, null (= the default), or a user / sync payload carrying `sentence_style`.
 * A payload without the field leaves the cache alone (an older server).
 */
export function writeSentenceStyle(src: SentenceStyle | null | { sentence_style?: string | null } | undefined): void {
  let value: unknown;
  if (src === null || typeof src === 'string') value = src;
  else if (src && typeof src === 'object' && 'sentence_style' in src) value = src.sentence_style ?? null;
  else return;
  const style = sentenceStyleOf(value);
  const before = readSentenceStyle();
  try { localStorage.setItem(KEY, style); } catch { /* storage unavailable */ }
  if (before !== style && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(SENTENCE_STYLE_CHANGED, { detail: style })); } catch { /* no window events */ }
  }
}
