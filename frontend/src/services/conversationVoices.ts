/**
 * The voices this account's conversation exercises are spoken in, cached on
 * the device so a conversation resolves the same voices offline (and the
 * prefetched clips are the ones it plays). The server copy is per account
 * (`GET/PUT /api/conversation-voices`, Settings → Conversation voices) and
 * arrives on `/api/auth/me` as `conversation_voices`.
 */
import { conversationVoicesFor, type ConversationExerciseSpec } from '@shared/lesson';

const KEY = 'conversationVoices';

/** The cached selection; null = none cached (the shipped defaults apply). */
export function readConversationVoices(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function writeConversationVoices(enabled: string[] | null | undefined): void {
  if (!Array.isArray(enabled)) return;
  try { localStorage.setItem(KEY, JSON.stringify(enabled)); } catch { /* storage unavailable */ }
}

/** The voices one conversation plays in on this device. */
export function voicesForConversation(ex: Pick<ConversationExerciseSpec, 'situation' | 'lines' | 'speakers'>): string[] {
  return conversationVoicesFor(ex, readConversationVoices());
}
