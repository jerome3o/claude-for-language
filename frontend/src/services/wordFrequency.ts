/**
 * The word-frequency list behind "Most common first" (shared/decks/frequency.ts), loaded
 * once per page from a lazily imported chunk. The chunk is a .js file, so the service
 * worker precaches it with the rest of the app: it works offline like everything else in
 * study. A failure only turns "Most common first" off for this load (null), never the queue.
 */
import { parseFrequencyList, type FrequencyIndex } from '@shared/decks';

let loading: Promise<FrequencyIndex | null> | null = null;

export function loadWordFrequency(): Promise<FrequencyIndex | null> {
  if (!loading) {
    loading = import('@shared/data/frequency/word-freq.txt?raw')
      .then(mod => parseFrequencyList(mod.default))
      .catch(err => {
        console.warn('[wordFrequency] list unavailable, "Most common first" skipped', err);
        loading = null; // try again next time
        return null;
      });
  }
  return loading;
}
