import { useSyncExternalStore } from 'react';
import { addRecapWord, addRecapWords, type AskRecapWord } from '@shared/coach/askChat';

/**
 * The words to recap of a Claude chat, kept on THIS device per thread (shared/coach/askChat.ts
 * `AskRecapWord`): every word tapped into the language explorer, and every word a "🎤 Read it back"
 * found a real mistake in. Not tied to the Coach — any Claude chat keys it by its own thread id.
 * Read by "Make flashcards from this chat" (the default selection) and, later, the recap pass.
 * localStorage `claude-chat-recap-v1:<thread>`; memory keeps it when storage is unavailable.
 */
const PREFIX = 'claude-chat-recap-v1:';
const memory = new Map<string, AskRecapWord[]>();
const listeners = new Set<() => void>();

function parse(raw: string | null): AskRecapWord[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (w): w is AskRecapWord =>
        !!w && typeof w === 'object' && typeof (w as AskRecapWord).hanzi === 'string' && Array.isArray((w as AskRecapWord).reasons),
    );
  } catch {
    return [];
  }
}

export function getRecapWords(threadId: string): AskRecapWord[] {
  const have = memory.get(threadId);
  if (have) return have;
  let list: AskRecapWord[] = [];
  try {
    list = parse(localStorage.getItem(PREFIX + threadId));
  } catch {
    /* storage blocked */
  }
  memory.set(threadId, list);
  return list;
}

function save(threadId: string, list: AskRecapWord[]): void {
  memory.set(threadId, list);
  try {
    localStorage.setItem(PREFIX + threadId, JSON.stringify(list));
  } catch {
    /* private mode — memory still has it */
  }
  for (const l of listeners) l();
}

export function recordRecapWord(threadId: string, word: AskRecapWord): void {
  save(threadId, addRecapWord(getRecapWords(threadId), word));
}

export function recordRecapWords(threadId: string, words: AskRecapWord[]): void {
  if (words.length === 0) return;
  save(threadId, addRecapWords(getRecapWords(threadId), words));
}

/** A new chat got its id: what was recorded under the draft id moves to it. */
export function moveRecapWords(from: string, to: string): void {
  const list = getRecapWords(from);
  if (list.length === 0) return;
  save(to, addRecapWords(getRecapWords(to), list));
  clearRecapWords(from);
}

export function clearRecapWords(threadId: string): void {
  memory.delete(threadId);
  try {
    localStorage.removeItem(PREFIX + threadId);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The thread's recap words, live. */
export function useRecapWords(threadId: string): AskRecapWord[] {
  return useSyncExternalStore(subscribe, () => getRecapWords(threadId), () => getRecapWords(threadId));
}

/** Tests: forget the in-memory copies. */
export function resetRecapMemory(): void {
  memory.clear();
}
