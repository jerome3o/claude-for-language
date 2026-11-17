import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { practiceChatRedirect } from '@shared/claude/practice';
import { getConversations } from '../api/client';
import { ChatPage } from './ChatPage';

/**
 * `/connections/:relId/chat[/:convId]`: the chat with a person (ChatPage). An OLD Claude practice chat
 * (`is_ai_conversation`) opened by its link — a bookmark, a notification, an MCP link, the Claude
 * relationship's list — goes to its Claude thread `/chats/claude/pc-<id>` instead: role-plays are
 * Claude threads, and the server copies the old chat on demand (docs/CHAT.md "Practice with Claude" →
 * "Old practice chats"). The relationship's conversation list is the same query ChatPage reads (one
 * fetch, cached), so a chat with a person opens at once while it loads.
 */
export function ChatRoute() {
  const { relId, convId } = useParams<{ relId: string; convId: string }>();
  const conversations = useQuery({
    queryKey: ['conversations', relId],
    queryFn: () => getConversations(relId!),
    enabled: !!relId && !!convId,
  });
  const practice = practiceChatRedirect(convId, conversations.data);
  if (practice) return <Navigate to={practice} replace />;
  return <ChatPage />;
}
