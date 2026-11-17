/**
 * `/coach` — the Sentence Coach's old address (docs/CHAT.md "Chats tab — one list for people and
 * Claude" → "Coach entry points"). The Coach lives in the Chats tab: its box at the bottom does
 * Ask · ✏️ Check · 🔍 Explain · Translate, and every result is a Claude thread. There is no Coach page
 * any more (Nov 2026): every address goes to a thread or the Chats box.
 *
 * - `/coach` (also `?focus=1`, the widget's ✏️) → `/chats?compose=1` (the box, ready to type);
 * - `?c=<id>` → `/chats/claude/<id>` (a coach conversation IS a thread: same id);
 * - `?text=&action=` (or English text, which can only be translated) → a new thread with that intent,
 *   sent at once; with `&from_message=` ("Open in Coach" from a chat message) the thread is started from
 *   that message — my own message's stored auto-check is the analysis, no Claude call, and opening it
 *   again reuses the chat; Chinese text without an action → the Chats box with the text, waiting on
 *   Ask / Check / Explain; `?draft=` → the box with the text.
 *
 * A study card no longer comes through here: it opens its thread directly with `source=study_card`
 * (pages/ClaudeThreadPage.tsx — "← Back to your card").
 */
import { useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { coachDeepLinkAction } from '@shared/coach';

export type CoachEntryTarget = { kind: 'redirect'; to: string };

/** Where a `/coach` address goes (pure). */
export function coachEntryTarget(params: URLSearchParams): CoachEntryTarget {
  const c = params.get('c');
  const text = params.get('text')?.trim() ?? '';
  const draft = params.get('draft')?.trim() ?? '';
  const fromMessage = params.get('from_message')?.trim() ?? '';
  if (c) return { kind: 'redirect', to: `/chats/claude/${encodeURIComponent(c)}` };
  if (text) {
    const action = coachDeepLinkAction(text, params.get('action'));
    if (action) {
      const q = new URLSearchParams({ text, intent: action, source: fromMessage ? 'chat_message' : 'coach_link' });
      if (fromMessage) q.set('from_message', fromMessage);
      return { kind: 'redirect', to: `/chats/claude/new?${q.toString()}` };
    }
    return { kind: 'redirect', to: `/chats?${new URLSearchParams({ compose: '1', text }).toString()}` };
  }
  if (draft) return { kind: 'redirect', to: `/chats?${new URLSearchParams({ compose: '1', text: draft }).toString()}` };
  return { kind: 'redirect', to: '/chats?compose=1' };
}

export function CoachEntry() {
  const [params] = useSearchParams();
  // Decided once per visit.
  const first = useRef<CoachEntryTarget | null>(null);
  if (!first.current) first.current = coachEntryTarget(params);
  // "Open in Coach" goes back to the chat it came from (the history), anything else to the Chats tab.
  const fromChat = first.current.to.includes('from_message=');
  return <Navigate to={first.current.to} replace state={fromChat ? null : { from: '/chats' }} />;
}

export default CoachEntry;
