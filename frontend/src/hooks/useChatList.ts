/**
 * The Chats inbox data (docs/CHAT.md "Chats tab"): `GET /api/me/chats`, cached
 * in localStorage per account so the list and the tab badge render instantly
 * offline (on the train), refreshed on open / focus / every minute.
 *
 * `live: true` (the inbox page) also holds the ChatHub socket and applies
 * `message` / `message_updated` / `read` events to the cached list with the
 * shared rules (`applyIncomingMessage` / `applyReadMarker`), refetching when
 * the socket (re)opens or an event names a conversation we don't have.
 */

import { prefetchClipsFromLiveEvents } from '../services/chatListening';
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getChatList } from '../api/chat';
import { useAuth } from '../contexts/AuthContext';
import { chatLive } from '../services/chatLive';
import {
  applyIncomingMessage,
  applyReadMarker,
  chatMessagePreview,
  type ChatListResponse,
} from '@shared/chats/inbox';

// v2: one chat per pair (migration 0102) — a v1 list may still hold the merged-away rows.
const CACHE_PREFIX = 'chat-list-v2:';

function dropOldCaches(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('chat-list-v1:')) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}
dropOldCaches();

export function readChatListCache(userId: string | undefined): ChatListResponse | undefined {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as ChatListResponse;
    return Array.isArray(v?.conversations) ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeChatListCache(userId: string, value: ChatListResponse): void {
  try {
    localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value));
  } catch {
    /* storage full / blocked: the list still works online */
  }
}

export function chatListKey(userId: string | undefined) {
  return ['chat-list', userId ?? ''] as const;
}

export function useChatList({ live = false }: { live?: boolean } = {}) {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const key = chatListKey(userId);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // Listening mode: clips of new messages are fetched as they become ready (once per page).
  useEffect(() => {
    if (userId) prefetchClipsFromLiveEvents(() => userIdRef.current ?? null);
  }, [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: getChatList,
    enabled: isAuthenticated && !!userId,
    staleTime: 10_000,
    // The inbox always asks again when it opens (a chat just read elsewhere).
    refetchOnMount: live ? 'always' : true,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: () => readChatListCache(userId),
  });

  useEffect(() => {
    if (userId && query.data && !query.isPlaceholderData) writeChatListCache(userId, query.data);
  }, [userId, query.data, query.isPlaceholderData]);

  useEffect(() => {
    if (!live || !userId) return;
    const release = chatLive.acquire();
    const refetch = () => void queryClient.invalidateQueries({ queryKey: chatListKey(userId) });
    const offStatus = chatLive.onStatus((s) => {
      if (s === 'open') refetch();
    });
    const offEvent = chatLive.onEvent((e) => {
      if (e.type !== 'message' && e.type !== 'message_updated' && e.type !== 'read') return;
      const current = queryClient.getQueryData<ChatListResponse>(chatListKey(userId)) ?? readChatListCache(userId);
      if (!current) return refetch();
      let rows = current.conversations;
      if (e.type === 'read') {
        // Only my own marker clears my unread count (the other person's is a receipt).
        if (e.user_id !== userId) return;
        rows = applyReadMarker(rows, e.conversation_id);
      } else {
        const m = e.message;
        const next = applyIncomingMessage(
          rows,
          {
            id: m.id,
            conversation_id: m.conversation_id,
            sender_id: m.sender_id,
            preview: chatMessagePreview({
              content: m.content ?? '',
              attachment_kind: m.attachment?.kind ?? null,
              attachment_name: m.attachment?.kind === 'file' ? m.attachment.name : null,
              deleted: !!m.deleted_at,
            }),
            created_at: m.created_at,
            attachment_kind: m.attachment?.kind ?? null,
          },
          userId,
        );
        if (!next) return refetch();
        // An edit of an older message must not count as new or reorder anything.
        if (e.type === 'message_updated') {
          rows = rows.map((r) => {
            const updated = next.find((n) => n.conversation_id === r.conversation_id)!;
            return r.last_message?.id === m.id ? { ...r, last_message: updated.last_message } : r;
          });
        } else {
          rows = next;
        }
      }
      const value = { ...current, conversations: rows };
      queryClient.setQueryData(chatListKey(userId), value);
      writeChatListCache(userId, value);
    });
    return () => {
      offEvent();
      offStatus();
      release();
    };
  }, [live, userId, queryClient]);

  /** Opening a chat reads it: clear its badge now rather than on the next fetch. */
  const markOpened = (conversationId: string) => {
    const current = queryClient.getQueryData<ChatListResponse>(key);
    if (!current || !userId) return;
    const value = { ...current, conversations: applyReadMarker(current.conversations, conversationId) };
    queryClient.setQueryData(key, value);
    writeChatListCache(userId, value);
  };

  return {
    markOpened,
    rows: query.data?.conversations ?? null,
    isLoading: query.isLoading && !query.data,
    error: query.error as Error | null,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
