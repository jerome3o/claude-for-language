/**
 * The word-tag lexicon (shared/data/word-tags/word-tags.txt; docs/STUDY_SESSION.md "Word tags"),
 * loaded once per page from a lazily imported chunk. The chunk is a .js file, so the service
 * worker precaches it with the rest of the app: tags work offline like everything else in study.
 * A failure only hides the tags for this load (null), never the card.
 *
 * Plus the per-device switch Settings → Study → "Word tags on the answer" (ON by default).
 */
import { parseWordTagLexicon, type WordTagLexicon } from '@shared/cards/word-tags';

let loading: Promise<WordTagLexicon | null> | null = null;

export function loadWordTagLexicon(): Promise<WordTagLexicon | null> {
  if (!loading) {
    loading = import('@shared/data/word-tags/word-tags.txt?raw')
      .then((mod) => parseWordTagLexicon(mod.default))
      .catch((err) => {
        console.warn('[wordTags] lexicon unavailable, tags hidden', err);
        loading = null; // try again next time
        return null;
      });
  }
  return loading;
}

const PREF_KEY = 'word-tags-on-answer-v1';
const listeners = new Set<(on: boolean) => void>();

/** Settings → Study → "Word tags on the answer": on unless switched off on this device. */
export function readWordTagsOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeWordTagsOn(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
  for (const l of listeners) l(on);
}

/** Called with the new value whenever the switch changes on this page. */
export function onWordTagsPrefChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
