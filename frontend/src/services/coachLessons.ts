/**
 * "🎯 Mini lesson on this mistake" (Sentence Coach; shared/coach/mistakeLesson.ts) on this device:
 * the last lesson written for each conversation is kept in localStorage, so the coach page can show
 * its card and the player can run it even when the conversation can't be fetched (offline). A few
 * kB per lesson; only the most recent MAX_KEPT are kept.
 */
import { parseMistakeLessonContent, type MistakeLessonContent } from '@shared/coach';

const KEY = 'coach-mistake-lessons-v1';
const MAX_KEPT = 20;

interface Kept {
  conversationId: string;
  messageId: string;
  content: string;
  at: number;
}

function readAll(): Kept[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Kept[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Remember the lesson (written / saved) of a conversation. */
export function rememberCoachLesson(conversationId: string, messageId: string, content: MistakeLessonContent): void {
  try {
    const rest = readAll().filter((k) => k.messageId !== messageId && k.conversationId !== conversationId);
    const next = [{ conversationId, messageId, content: JSON.stringify(content), at: Date.now() }, ...rest].slice(0, MAX_KEPT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked: the server copy is still there */
  }
}

/** The kept lesson of a conversation (or by its message id). */
export function cachedCoachLesson(conversationId: string, messageId?: string): { messageId: string; content: MistakeLessonContent } | null {
  const hit = readAll().find((k) => (messageId ? k.messageId === messageId : k.conversationId === conversationId));
  const content = hit ? parseMistakeLessonContent(hit.content) : null;
  return hit && content ? { messageId: hit.messageId, content } : null;
}
