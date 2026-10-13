/**
 * "New characters shimmer" on the study card (shared/study/newCharacters.ts; docs/STUDY_SESSION.md).
 *
 * The seen set (Han characters of every note with a reviewed card, any deck — the queue's
 * "New characters first" rule) is kept in memory for the session: `getStudyQueue` primes it
 * from what it already loaded (db/database.ts), else it is loaded once from IndexedDB, and a
 * rating adds the card's characters. A card works out its new characters once, when it is shown.
 *
 * ONLY the flashcard study session shimmers (`useNewCharacters(…, inStudySession)`): the other
 * screens that show the study card (the homework pass, tutor-notes practice) never do. And until
 * the seen set has actually loaded a card has NO new characters — a failed / pending load is never
 * "nothing seen" (`cardNewCharacters` in shared/study/newCharacters.ts).
 *
 * Plus the per-device switch Settings → Study → "Shimmer new characters" (ON by default).
 */
import { useEffect, useState } from 'react';
import { cardNewCharacters, markCharactersSeen, seenCharactersOf } from '@shared/study/newCharacters';
import { db } from '../db/database';
import { CardQueue } from '../types';

let seen: Set<string> | null = null;
let loading: Promise<Set<string> | null> | null = null;

/** The study queue built the seen set (same load): keep it for the session. */
export function primeSeenCharacters(chars: Set<string>): void {
  seen = chars;
  loading = null;
}

/**
 * The seen set, loading it from IndexedDB the first time. null when it couldn't be loaded — then
 * nothing shimmers (a failure is NOT "nothing seen", which would make every character new).
 */
export function loadSeenCharacters(): Promise<Set<string> | null> {
  if (seen) return Promise.resolve(seen);
  if (!loading) {
    loading = (async () => {
      const reviewed = await db.cards.where('queue').above(CardQueue.NEW).toArray();
      const noteIds = [...new Set(reviewed.map(c => c.note_id))];
      const notes = await db.notes.bulkGet(noteIds);
      const built = seenCharactersOf(notes.map(n => n?.hanzi ?? ''));
      if (!seen) seen = built;
      return seen;
    })().catch(err => {
      console.warn('[newCharacters] seen set unavailable', err);
      loading = null;
      return null;
    });
  }
  return loading;
}

/** The seen set if already in memory (no flash of "not new" on a card shown right after). */
export function peekSeenCharacters(): Set<string> | null {
  return seen;
}

/** A card of this note was rated: its characters are seen for every later card. */
export function noteCharactersSeen(hanzi: string): void {
  if (seen) markCharactersSeen(seen, hanzi);
  else void loadSeenCharacters().then(s => s && markCharactersSeen(s, hanzi));
}

/** Tests only. */
export function resetSeenCharactersForTests(): void {
  seen = null;
  loading = null;
}

const PREF_KEY = 'new-char-shimmer-v1';
const listeners = new Set<(on: boolean) => void>();

/** Settings → Study → "Shimmer new characters": on unless switched off on this device. */
export function readNewCharShimmerOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeNewCharShimmerOn(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the default stays */
  }
  for (const l of listeners) l(on);
}

function useNewCharShimmerOn(): boolean {
  const [on, setOn] = useState(readNewCharShimmerOn);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The never-seen characters of the card on screen, worked out ONCE per card (`cardKey`): rating
 * it makes them seen, but the shimmer stays while this card is shown. Empty when switched off,
 * outside the flashcard study session (`inStudySession` false: the homework pass, tutor-notes
 * practice) and while the seen set hasn't loaded.
 */
export function useNewCharacters(cardKey: string, hanzi: string, inStudySession: boolean): ReadonlySet<string> {
  const on = useNewCharShimmerOn();
  const [result, setResult] = useState<{ key: string; chars: ReadonlySet<string> } | null>(() => {
    if (!inStudySession) return null;
    const s = peekSeenCharacters();
    return s ? { key: cardKey, chars: new Set(cardNewCharacters(hanzi, s, true)) } : null;
  });
  useEffect(() => {
    if (!inStudySession || result?.key === cardKey) return;
    let alive = true;
    const s = peekSeenCharacters();
    if (s) {
      setResult({ key: cardKey, chars: new Set(cardNewCharacters(hanzi, s, true)) });
      return;
    }
    void loadSeenCharacters().then(loaded => {
      // Not loaded (failed): no new characters — never "nothing seen".
      if (alive) setResult({ key: cardKey, chars: new Set(cardNewCharacters(hanzi, loaded, true)) });
    });
    return () => {
      alive = false;
    };
    // Once per card: `hanzi` of the same card doesn't change what was new when it arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, inStudySession]);
  return on && inStudySession && result?.key === cardKey ? result.chars : NONE;
}
