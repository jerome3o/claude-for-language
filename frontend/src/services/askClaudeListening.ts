import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { addRevealed } from '@shared/chats/listening';
import { useAuth } from '../contexts/AuthContext';
import { setAskClaudeListening } from '../api/client';
import { track } from './analytics';

/**
 * Ask Claude 🎧 Listen first (docs/STUDY_SESSION.md "Ask Claude"; rules in shared/study/askClaude.ts):
 * the chat's listening mode in the Ask Claude sheet. Like the chat's setting it belongs to the
 * account — `users.ask_claude_listening`, on `/api/auth/me` (cached with the signed-in user, so it
 * is known offline), changed with `PUT /api/profile/ask-claude-listening` — and shows at once; every
 * ask also sends the switch on screen (`listening`), so the server makes the clip first.
 * Revealed answers are this device's only, like the chat's (`ask-claude-revealed-v1`, newest 500).
 */
export function useAskListening(): [boolean, (on: boolean, source: 'settings' | 'sheet') => Promise<void>] {
  const { user, refreshUser } = useAuth();
  const stored = user?.ask_claude_listening ?? false;
  const [override, setOverride] = useState<boolean | null>(null);
  // A fresh value from the server replaces the local one.
  useEffect(() => {
    setOverride(null);
  }, [stored]);

  const set = useCallback(
    async (on: boolean, source: 'settings' | 'sheet') => {
      setOverride(on);
      track('study.ask_claude_listening', { on, source });
      try {
        await setAskClaudeListening(on);
        await refreshUser();
      } catch (err) {
        // Kept on this device for now; the next ask carries it anyway.
        console.warn('[ask] saving 🎧 Listen first failed:', err);
      }
    },
    [refreshUser],
  );

  return [override ?? stored, set];
}

// ---------- Revealed answers (this device) ----------

const REVEALED_KEY = 'ask-claude-revealed-v1';
const listeners = new Set<() => void>();
let revealed: string[] | null = null;

function readRevealed(): string[] {
  if (revealed) return revealed;
  try {
    const raw = localStorage.getItem(REVEALED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    revealed = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    revealed = [];
  }
  return revealed;
}

/** Replace the revealed list (an already-capped list from `addRevealed` / `revealedWhenListeningOn`). */
export function setAskRevealed(next: string[]): void {
  revealed = next;
  try {
    localStorage.setItem(REVEALED_KEY, JSON.stringify(next));
  } catch {
    /* private mode — memory still has it */
  }
  for (const l of listeners) l();
}

export function revealAskAnswer(id: string): void {
  track('study.ask_claude_listen_reveal');
  setAskRevealed(addRevealed(readRevealed(), id));
}

export function getAskRevealed(): string[] {
  return readRevealed();
}

/** Tests: forget the in-memory copy. */
export function resetAskRevealedForTests(): void {
  revealed = null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The revealed answer ids, re-rendering when one is revealed. */
export function useAskRevealed(): readonly string[] {
  return useSyncExternalStore(subscribe, readRevealed, readRevealed);
}
