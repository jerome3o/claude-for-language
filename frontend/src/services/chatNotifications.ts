/**
 * Chat notifications on the web (docs/CHAT.md §3, §5):
 *  - the service worker (public/push-sw.js) shows a `chat_message` push unless a
 *    focused, visible tab is already on that chat — `chatOpenInFront` is the rule,
 *    mirrored in the SW as `pushChatOpenInFront` (push-sw.test.ts runs both);
 *  - an open chat closes its conversation's notifications (`closeChatNotifications`)
 *    and moves the read marker (`POST /api/conversations/:id/read`, `useChatReadMarker`).
 */

import { useEffect, useRef } from 'react';
import { markConversationRead } from '../api/client';

export interface WindowClientInfo {
  url: string;
  focused?: boolean;
  visibilityState?: string;
}

/** The path of a URL (absolute or app-relative), trailing slashes dropped; null when unparseable. */
export function chatPathOf(url: string): string | null {
  try {
    return new URL(url, 'https://app.invalid').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

/** True when a focused, visible window is on the chat this push links to — then no notification. */
export function chatOpenInFront(data: { url?: string | null } | null | undefined, clients: WindowClientInfo[]): boolean {
  const target = data?.url ? chatPathOf(data.url) : null;
  if (!target) return false;
  return clients.some((c) => !!c.focused && c.visibilityState === 'visible' && chatPathOf(c.url) === target);
}

export const chatNotificationTag = (conversationId: string) => `chat-${conversationId}`;

/** Close the notifications this browser shows for one conversation (best effort). */
export async function closeChatNotifications(conversationId: string): Promise<number> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || typeof reg.getNotifications !== 'function') return 0;
    const list = await reg.getNotifications({ tag: chatNotificationTag(conversationId) });
    list.forEach((n) => n.close());
    return list.length;
  } catch {
    return 0;
  }
}

/** The newest `created_at` among messages (ISO strings compare as strings), or null. */
export function newestCreatedAt(messages: ReadonlyArray<{ created_at: string }>): string | null {
  let newest: string | null = null;
  for (const m of messages) if (m.created_at && (newest === null || m.created_at > newest)) newest = m.created_at;
  return newest;
}

/** Only move the marker forward: send when there is something newer than what was last sent. */
export function shouldSendRead(newest: string | null, lastSent: string | null): boolean {
  return !!newest && (lastSent === null || newest > lastSent);
}

const READ_DEBOUNCE_MS = 800;

function tabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * While a chat is open and the tab is visible: close its notifications and mark
 * it read up to the newest message (debounced; failures and offline ignored — the
 * next change or the tab becoming visible tries again).
 */
export function useChatReadMarker(conversationId: string | undefined, newest: string | null, enabled = true): void {
  const lastSent = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ conversationId, newest, enabled });
  latest.current = { conversationId, newest, enabled };

  useEffect(() => {
    lastSent.current = null;
  }, [conversationId]);

  useEffect(() => {
    const flush = () => {
      const { conversationId: id, newest: upTo, enabled: on } = latest.current;
      if (!id || !on || !tabVisible()) return;
      void closeChatNotifications(id);
      if (!shouldSendRead(upTo, lastSent.current)) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const sent = upTo!;
      lastSent.current = sent;
      markConversationRead(id, sent).catch(() => {
        if (lastSent.current === sent) lastSent.current = null; // retry on the next change / visibility
      });
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, READ_DEBOUNCE_MS);
    };
    schedule();
    const onVisible = () => {
      if (tabVisible()) schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [conversationId, newest, enabled]);
}

const NUDGE_KEY = 'chat-notify-nudge-dismissed';

export function chatNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissChatNudge(): void {
  try {
    localStorage.setItem(NUDGE_KEY, '1');
  } catch {
    /* private mode */
  }
}
