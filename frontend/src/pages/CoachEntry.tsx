/**
 * `/coach` — the Sentence Coach's old address (docs/CHAT.md "Chats tab — one list for people and
 * Claude" → "Coach entry points"). The Coach lives in the Chats tab now: its box at the bottom does
 * Ask · ✏️ Check · 🔍 Explain · Translate, and every result is a Claude thread.
 *
 * - `/coach` (also `?focus=1`, the widget's ✏️) → `/chats?compose=1` (the box, ready to type);
 * - `?c=<id>` → `/chats/claude/<id>` (a coach conversation IS a thread: same id);
 * - `?text=&action=` (or English text, which can only be translated) → a new thread with that intent,
 *   sent at once; Chinese text without an action → the Chats box with the text, waiting on
 *   Ask / Check / Explain; `?draft=` → the box with the text.
 *
 * Two exceptions keep the Coach page (pages/SentenceCoachPage.tsx), as #690 left them: "Open in Coach"
 * from a chat message (`from_message`: the stored auto-check is reused, no Claude call) and anything
 * opened from a study card (the "Back to your card" return path). Once the Coach page is showing, it
 * stays for the rest of that visit (its own `?c=` after starting a conversation included).
 */
import { lazy, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { coachDeepLinkAction } from '@shared/coach';
import { coachReturnPath } from '../services/studyResume';
import { Header } from '../components/Header';

const SentenceCoachPage = lazy(() => import('./SentenceCoachPage').then((m) => ({ default: m.SentenceCoachPage })));

export type CoachEntryTarget = { kind: 'coach' } | { kind: 'redirect'; to: string };

/**
 * Where a `/coach` address goes (pure). `returnTo` = the study card's return path: set by the card right
 * before it opens the Coach and cleared when the Coach page closes, so it means "came from a card".
 */
export function coachEntryTarget(params: URLSearchParams, returnTo: string | null): CoachEntryTarget {
  const c = params.get('c');
  const text = params.get('text')?.trim() ?? '';
  const draft = params.get('draft')?.trim() ?? '';
  if (params.get('from_message') || returnTo) return { kind: 'coach' };
  if (c) return { kind: 'redirect', to: `/chats/claude/${encodeURIComponent(c)}` };
  if (text) {
    const action = coachDeepLinkAction(text, params.get('action'));
    if (action) {
      const q = new URLSearchParams({ text, intent: action, source: 'coach_link' });
      return { kind: 'redirect', to: `/chats/claude/new?${q.toString()}` };
    }
    return { kind: 'redirect', to: `/chats?${new URLSearchParams({ compose: '1', text }).toString()}` };
  }
  if (draft) return { kind: 'redirect', to: `/chats?${new URLSearchParams({ compose: '1', text: draft }).toString()}` };
  return { kind: 'redirect', to: '/chats?compose=1' };
}

export function CoachEntry() {
  const [params] = useSearchParams();
  // Decided once per visit: the Coach page, once shown, keeps its own address changes.
  const first = useRef<CoachEntryTarget | null>(null);
  if (!first.current) first.current = coachEntryTarget(params, coachReturnPath());
  if (first.current.kind === 'coach') {
    return (
      <>
        <Header />
        <SentenceCoachPage />
      </>
    );
  }
  return <Navigate to={first.current.to} replace state={{ from: '/chats' }} />;
}

export default CoachEntry;
