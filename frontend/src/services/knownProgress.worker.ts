/// <reference lib="webworker" />
/**
 * Replays every card's review events off the main thread (35k events ≈ 1 s of FSRS on a
 * laptop, more on a phone) for the Progress page's Characters & words section.
 */
import { knownProgress, historyPoints } from '@shared/progress';
import type { KnownInput } from './knownProgress';

self.onmessage = (e: MessageEvent<KnownInput>) => {
  const { notes, cards, events, now_ms } = e.data;
  try {
    self.postMessage({ ok: true, result: knownProgress(notes, cards, events, historyPoints(events, now_ms)) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
