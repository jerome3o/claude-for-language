/**
 * Scrolling in an open chat (docs/CHAT.md PR 2 "Unread"):
 *  - on open: to the "New messages" divider when there is one, else the bottom;
 *  - new messages: follow them when at the bottom (or when I sent it), else count
 *    them for the "↓ N new" pill;
 *  - `jumpTo(id)`: centre a message and flash it (pins, search).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { countNewFromOthers } from '../services/chatThread';

const BOTTOM_SLACK_PX = 80;

interface Msg {
  id: string;
  sender_id: string;
  created_at: string;
}

export function useChatScroll({
  messages,
  myId,
  ready,
  dividerId,
  resetKey,
  followKey,
}: {
  messages: readonly Msg[];
  myId: string;
  /** The first load is in (the divider is known). */
  ready: boolean;
  dividerId: string | null;
  /** Changes per conversation. */
  resetKey: string | undefined;
  /** Something else at the bottom grew (the typing row): follow it when at the bottom. */
  followKey?: unknown;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [seenUpTo, setSeenUpTo] = useState<string | null>(null);
  const initialDone = useRef(false);
  const lastId = useRef<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const newest = messages.length ? messages[messages.length - 1] : null;

  useLayoutEffect(() => {
    initialDone.current = false;
    lastId.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
    setSeenUpTo(null);
  }, [resetKey]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
    }
  }, []);

  // First paint of a conversation: divider or bottom, no animation.
  useLayoutEffect(() => {
    if (!ready || initialDone.current || messages.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    initialDone.current = true;
    lastId.current = newest?.id ?? null;
    const divider = dividerId ? el.querySelector<HTMLElement>('[data-unread-divider]') : null;
    if (divider) {
      el.scrollTop = Math.max(0, divider.offsetTop - el.offsetTop - 12);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    onScroll();
  }, [ready, messages.length, dividerId, newest, onScroll]);

  // New messages after that.
  useLayoutEffect(() => {
    if (!initialDone.current || !newest) return;
    if (newest.id === lastId.current) return;
    lastId.current = newest.id;
    if (atBottomRef.current || newest.sender_id === myId) scrollToBottom(true);
  }, [newest, myId, scrollToBottom]);

  useLayoutEffect(() => {
    if (initialDone.current && atBottomRef.current) scrollToBottom(true);
  }, [followKey, scrollToBottom]);

  // While at the bottom everything is seen.
  useEffect(() => {
    if (atBottom && newest) setSeenUpTo((prev) => (!prev || newest.created_at > prev ? newest.created_at : prev));
  }, [atBottom, newest]);

  const pillCount = atBottom ? 0 : countNewFromOthers(messages, myId, seenUpTo);

  const jumpTo = useCallback((id: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    return true;
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  return { containerRef, onScroll, atBottom, pillCount, scrollToBottom, jumpTo, flashId };
}
