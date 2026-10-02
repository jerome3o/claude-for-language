/**
 * One open chat thread (docs/CHAT.md PR 2): the server's messages merged by id
 * from every source (first load, `?since=` polls, the live socket, my own sends
 * and edits), my outbox's pending bubbles, the read state, and the other
 * person's typing indicator.
 *
 * Polling: every 3 s while the live socket is down, a 30 s safety poll while it
 * is up, and once after every (re)connect.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMessages } from '../api/client';
import type { ChatReadState } from '../api/client';
import type { ChatAttachment, MessageWithSender } from '../types';
import { advanceCursor, deliveredClientIds, mergeMessages, newestVersion, TYPING_SHOW_MS } from '../services/chatThread';
import { chatLive, type ChatLiveStatus } from '../services/chatLive';
import {
  enqueueOutbox,
  flushOutbox,
  listOutbox,
  onOutboxDelivered,
  startOutbox,
  subscribeOutbox,
  retryOutbox,
  discardOutbox,
  type OutboxEntry,
} from '../services/chatOutbox';
import { forgetChatMedia, primeChatMedia } from '../services/chatMedia';

export const POLL_SOCKET_DOWN_MS = 3000;
export const POLL_SOCKET_UP_MS = 30_000;

/** A message as the chat renders it: a server message, or a pending send from the outbox. */
export type ChatMessage = MessageWithSender & {
  outbox?: { client_id: string; status: OutboxEntry['status']; error?: string | null; blob?: Blob | null };
};

interface Me {
  id: string;
  name: string | null;
  picture_url: string | null;
}

function outboxBubble(entry: OutboxEntry, me: Me): ChatMessage {
  let attachment: ChatAttachment | null = null;
  if (entry.kind === 'image') {
    attachment = { kind: 'image', width: entry.width || 0, height: entry.height || 0, bytes: entry.blob?.size || 0, mime: entry.mime || 'image/jpeg' };
  } else if (entry.kind === 'voice') {
    attachment = {
      kind: 'voice',
      duration_ms: entry.duration_ms || 0,
      bytes: entry.blob?.size || 0,
      mime: entry.mime || 'audio/webm',
      transcript_status: 'pending',
    };
  }
  return {
    id: `outbox:${entry.client_id}`,
    conversation_id: entry.conversation_id,
    sender_id: me.id,
    content: entry.content,
    created_at: entry.created_at,
    check_status: null,
    check_feedback: null,
    recording_url: null,
    reply_to_message_id: entry.reply_to_message_id ?? null,
    translation: null,
    segmentation: null,
    client_id: entry.client_id,
    attachment,
    media_url: null,
    sender: { id: me.id, name: me.name, picture_url: me.picture_url },
    reply_to:
      entry.reply_to_message_id && entry.reply_preview
        ? {
            id: entry.reply_to_message_id,
            content: entry.reply_preview.content,
            sender: { id: '', name: entry.reply_preview.sender_name, picture_url: null },
          }
        : null,
    outbox: { client_id: entry.client_id, status: entry.status, error: entry.error, blob: entry.blob },
  };
}

export interface ChatThread {
  isLoading: boolean;
  error: unknown;
  /** Server messages (oldest first) followed by my pending sends. */
  messages: ChatMessage[];
  /** Server messages only. */
  serverMessages: MessageWithSender[];
  readState: ChatReadState;
  /** My read marker as it was when the chat opened (the "New messages" divider). */
  readMarkerAtOpen: string | null;
  /** True once the first load has given us `readMarkerAtOpen`. */
  openedAt: number | null;
  otherTyping: boolean;
  liveStatus: ChatLiveStatus;
  sendText: (content: string, replyTo?: MessageWithSender | null) => Promise<void>;
  sendMedia: (input: {
    kind: 'image' | 'voice';
    blob: Blob;
    caption?: string;
    width?: number;
    height?: number;
    duration_ms?: number;
    replyTo?: MessageWithSender | null;
  }) => Promise<void>;
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
  /** Merge a message the page got from elsewhere (edit / delete / pin results, the AI's reply). */
  applyMessage: (message: MessageWithSender) => void;
  pollNow: () => Promise<void>;
  /** Tell the other person I'm typing (throttling is the caller's). */
  sendTyping: () => void;
}

export function useChatThread(
  convId: string | undefined,
  me: Me | null,
  opts: { enabled?: boolean; onDelivered?: (message: MessageWithSender) => void } = {},
): ChatThread {
  const enabled = !!convId && !!me && opts.enabled !== false;
  const onDeliveredRef = useRef(opts.onDelivered);
  onDeliveredRef.current = opts.onDelivered;
  const openedRef = useRef(false);
  const [serverMessages, setServerMessages] = useState<MessageWithSender[]>([]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [readState, setReadState] = useState<ChatReadState>({ me: null, other: null });
  const [readMarkerAtOpen, setReadMarkerAtOpen] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [typingUntil, setTypingUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [liveStatus, setLiveStatus] = useState<ChatLiveStatus>(chatLive.getStatus());
  const cursor = useRef<string | null>(null);
  const convRef = useRef(convId);
  convRef.current = convId;
  const meId = me?.id ?? '';

  // Reset per conversation.
  useEffect(() => {
    setServerMessages([]);
    setOutbox([]);
    setReadState({ me: null, other: null });
    setReadMarkerAtOpen(null);
    setOpenedAt(null);
    setTypingUntil(0);
    cursor.current = null;
    openedRef.current = false;
  }, [convId]);

  const initial = useQuery({
    queryKey: ['messages', convId],
    queryFn: () => getMessages(convId!),
    enabled,
    staleTime: 0,
  });

  const mergeIn = useCallback((incoming: MessageWithSender[]) => {
    const mine = incoming.filter((m) => m.conversation_id === convRef.current || !m.conversation_id);
    if (mine.length === 0) return;
    setServerMessages((prev) => mergeMessages(prev, mine));
    cursor.current = advanceCursor(cursor.current, newestVersion(mine));
  }, []);

  const mergeReadState = useCallback((rs: ChatReadState | undefined) => {
    if (!rs) return;
    setReadState((prev) => ({
      me: advanceCursor(prev.me, rs.me),
      other: advanceCursor(prev.other, rs.other),
    }));
  }, []);

  // First load (and every refetch, e.g. after a reaction).
  useEffect(() => {
    const data = initial.data;
    if (!data) return;
    mergeIn(data.messages);
    cursor.current = advanceCursor(cursor.current, data.latest_timestamp);
    mergeReadState(data.read_state);
    // A cached copy from an earlier visit carries an old marker: wait for this visit's load.
    if (!openedRef.current && initial.isFetchedAfterMount) {
      openedRef.current = true;
      setReadMarkerAtOpen(data.read_state?.me ?? null);
      setOpenedAt(Date.now());
    }
  }, [initial.data, initial.isFetchedAfterMount, mergeIn, mergeReadState]);

  const pollNow = useCallback(async () => {
    const id = convRef.current;
    if (!id || !cursor.current) return;
    try {
      const result = await getMessages(id, cursor.current);
      if (convRef.current !== id) return;
      mergeIn(result.messages);
      cursor.current = advanceCursor(cursor.current, result.latest_timestamp);
      mergeReadState(result.read_state);
    } catch {
      /* offline or a hiccup — the next poll tries again */
    }
  }, [mergeIn, mergeReadState]);

  // The live socket.
  useEffect(() => {
    if (!enabled) return;
    const release = chatLive.acquire();
    setLiveStatus(chatLive.getStatus());
    const offStatus = chatLive.onStatus((s) => {
      setLiveStatus(s);
      if (s === 'open') void pollNow(); // catch up on whatever happened while it was down
    });
    const offEvent = chatLive.onEvent((e) => {
      const id = convRef.current;
      if (!id) return;
      if ((e.type === 'message' || e.type === 'message_updated') && e.message.conversation_id === id) {
        mergeIn([e.message]);
        if (e.message.deleted_at) void forgetChatMedia(e.message.id);
        if (e.type === 'message' && e.message.sender_id !== meId) setTypingUntil(0);
      } else if (e.type === 'read' && e.conversation_id === id) {
        if (e.user_id === meId) mergeReadState({ me: e.last_read_at, other: null });
        else mergeReadState({ me: null, other: e.last_read_at });
      } else if (e.type === 'typing' && e.conversation_id === id && e.user_id !== meId) {
        setTypingUntil(Date.now() + TYPING_SHOW_MS);
      }
    });
    return () => {
      offStatus();
      offEvent();
      release();
    };
  }, [enabled, meId, mergeIn, mergeReadState, pollNow]);

  // Polling: fast while the socket is down, a slow safety net while it is up.
  const hasCursor = initial.data !== undefined;
  useEffect(() => {
    if (!enabled || !hasCursor) return;
    const every = liveStatus === 'open' ? POLL_SOCKET_UP_MS : POLL_SOCKET_DOWN_MS;
    const t = setInterval(() => void pollNow(), every);
    return () => clearInterval(t);
  }, [enabled, hasCursor, liveStatus, pollNow]);

  // A push for this chat (the service worker tells every tab): fetch at once.
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data?.type === 'push' ? event.data.data : null;
      if (data?.type === 'chat_message' && data.conversation_id === convRef.current) void pollNow();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [enabled, pollNow]);

  // The outbox: load this chat's pending sends, follow changes, flush on open.
  useEffect(() => {
    if (!enabled || !convId) return;
    let alive = true;
    const load = () =>
      listOutbox(convId).then((rows) => {
        if (alive) setOutbox(rows);
      });
    startOutbox();
    void load();
    const off = subscribeOutbox(() => void load());
    const offDelivered = onOutboxDelivered((message, entry) => {
      if (entry.conversation_id !== convRef.current) return;
      if (entry.blob && (entry.kind === 'image' || entry.kind === 'voice')) void primeChatMedia(message.id, entry.blob);
      mergeIn([message]);
      onDeliveredRef.current?.(message);
    });
    void flushOutbox({ conversationId: convId, force: true });
    return () => {
      alive = false;
      off();
      offDelivered();
    };
  }, [enabled, convId, mergeIn]);

  // The typing indicator expires by itself.
  useEffect(() => {
    if (typingUntil <= Date.now()) return;
    const t = setTimeout(() => setNow(Date.now()), typingUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [typingUntil]);

  const replyPreview = (m: MessageWithSender | null | undefined) =>
    m ? { content: m.content || (m.attachment?.kind === 'image' ? '📷 Photo' : m.attachment?.kind === 'voice' ? '🎤 Voice message' : ''), sender_name: m.sender.name } : null;

  const sendText = useCallback(
    async (content: string, replyTo?: MessageWithSender | null) => {
      if (!convId) return;
      await enqueueOutbox({
        conversation_id: convId,
        kind: 'text',
        content,
        reply_to_message_id: replyTo?.id ?? null,
        reply_preview: replyPreview(replyTo),
      });
    },
    [convId],
  );

  const sendMedia = useCallback<ChatThread['sendMedia']>(
    async (input) => {
      if (!convId) return;
      await enqueueOutbox({
        conversation_id: convId,
        kind: input.kind,
        content: input.caption?.trim() || '',
        blob: input.blob,
        mime: input.blob.type,
        width: input.width ?? null,
        height: input.height ?? null,
        duration_ms: input.duration_ms ?? null,
        reply_to_message_id: input.replyTo?.id ?? null,
        reply_preview: replyPreview(input.replyTo),
      });
    },
    [convId],
  );

  const messages = useMemo<ChatMessage[]>(() => {
    if (!me) return serverMessages;
    const delivered = deliveredClientIds(serverMessages, me.id);
    const pending = outbox.filter((e) => !delivered.has(e.client_id)).map((e) => outboxBubble(e, me));
    return pending.length ? [...serverMessages, ...pending] : serverMessages;
  }, [serverMessages, outbox, me]);

  const sendTyping = useCallback(() => {
    if (convRef.current) chatLive.send({ type: 'typing', conversation_id: convRef.current });
  }, []);

  return {
    isLoading: initial.isLoading,
    error: initial.error,
    messages,
    serverMessages,
    readState,
    readMarkerAtOpen,
    openedAt,
    otherTyping: typingUntil > now && typingUntil > Date.now(),
    liveStatus,
    sendText,
    sendMedia,
    retry: (clientId) => void retryOutbox(clientId),
    discard: (clientId) => void discardOutbox(clientId),
    applyMessage: (m) => mergeIn([m]),
    pollNow,
    sendTyping,
  };
}
