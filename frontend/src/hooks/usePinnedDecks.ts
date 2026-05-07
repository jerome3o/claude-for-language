import { useState, useCallback } from 'react';

const STORAGE_KEY = 'pinned_deck_ids';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function savePinned(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function usePinnedDecks() {
  const [pinned, setPinned] = useState<Set<string>>(loadPinned);

  const togglePin = useCallback((deckId: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) {
        next.delete(deckId);
      } else {
        next.add(deckId);
      }
      savePinned(next);
      return next;
    });
  }, []);

  const isPinned = useCallback((deckId: string) => pinned.has(deckId), [pinned]);

  function sortWithPinnedFirst<T extends { id: string }>(decks: T[]): T[] {
    return [...decks].sort((a, b) => {
      const aP = pinned.has(a.id) ? 0 : 1;
      const bP = pinned.has(b.id) ? 0 : 1;
      return aP - bP;
    });
  }

  return { isPinned, togglePin, sortWithPinnedFirst, pinnedIds: pinned };
}
