/**
 * Hard mode in the homework pass (docs/HOMEWORK.md §3d): the Sentence round needs the words' sentences,
 * and one-off homework notes often have no generated set yet. When a pass opens in Hard mode, its words
 * with NO set are queued for one (`POST /api/sentences/prefetch`, the pass's words first) and those with
 * fewer than the round's four ask for more (`requestMoreSentences(…, 'few')` — once a day per word, kept
 * for the next sync when offline). The rows reach the device as each card shows (`useRoundSentences`
 * fetches a missing set) or with the next sentence sync; until then the round has what there is — none
 * → no round, the answer side as usual.
 */
import { SENTENCE_ROUND_MIN_VISIBLE } from '@shared/study/sentenceHistory';
import { prefetchSentenceSets } from '../api/client';
import { db } from '../db/database';
import { getLocalSentenceCounts } from './sentence-sets';
import { requestMoreSentences } from './sentencePractice';
import { isEffectivelyOffline } from './offlineMode';

/** Passes already asked for in this app session. */
const asked = new Set<string>();

export async function ensurePassSentences(assignmentId: string, noteIds: readonly string[]): Promise<{ queued: number; topUps: number }> {
  if (asked.has(assignmentId) || noteIds.length === 0) return { queued: 0, topUps: 0 };
  asked.add(assignmentId);
  const ids = Array.from(new Set(noteIds));
  const [counts, notes] = await Promise.all([getLocalSentenceCounts(ids), db.notes.bulkGet(ids)]);
  const none: string[] = [];
  const few: string[] = [];
  ids.forEach((id, i) => {
    const set = counts.get(id) ?? 0;
    const clue = notes[i]?.sentence_clue?.trim() ? 1 : 0;
    if (set === 0) none.push(id);
    else if (set + clue < SENTENCE_ROUND_MIN_VISIBLE) few.push(id);
  });
  for (const id of few) requestMoreSentences(id, 'few');
  let queued = 0;
  if (none.length > 0 && typeof navigator !== 'undefined' && navigator.onLine && !isEffectivelyOffline()) {
    try {
      queued = (await prefetchSentenceSets(none.slice(0, 100), Math.min(100, none.length))).queued;
    } catch {
      // The hourly sentence top-up in sync gets to them; ask again next time the pass opens.
      asked.delete(assignmentId);
    }
  } else if (none.length > 0) {
    asked.delete(assignmentId);
  }
  return { queued, topUps: few.length };
}
