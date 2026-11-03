/**
 * Context `chat_message` — Discuss with Claude about one message of a tutor ↔ student chat
 * (`POST /api/messages/:id/discuss`). load = the access check (the message, its conversation, an ACTIVE
 * relationship the caller is in — one `db.batch`) + the surrounding chat (`getChatContext`). The
 * message and the chat ride in the first user message. create_flashcards is collected and comes back
 * to the app for review, never saved here.
 */
import { getChatContext } from '../../conversations';
import { CHAT_TOOL_RULE, DISCUSS_MESSAGE_SYSTEM_PROMPT } from '../persona';
import type { GeneratedNote } from '../../../types';
import { ClaudeContextError, type AgentEnv, type ChatTurn, type ContextProvider, type ToolAction, type ToolName } from '../types';

/** Discuss with Claude's tools, in the order the model sees them. */
export const CHAT_MESSAGE_TOOLS: readonly ToolName[] = ['create_flashcards', 'search_cards', 'list_student_decks', 'bump_cards', 'search_my_chats', 'read_chat'];

/** Discuss with Claude's output budget: an answer or a few flashcards. */
export const DISCUSS_MAX_TOKENS = 8000;

interface ChatMessageData {
  content: string;
  chatContext: string;
}

/** The message + the chat around it, when the caller may see them (404 / 403 otherwise). */
export async function loadDiscussedMessage(env: AgentEnv, messageId: string, userId: string): Promise<ChatMessageData> {
  const [message, conversation, relationship] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare('SELECT id, conversation_id, content FROM messages WHERE id = ?').bind(messageId),
    env.DB.prepare('SELECT id, relationship_id FROM conversations WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)').bind(messageId),
    env.DB
      .prepare(
        `SELECT id FROM tutor_relationships
          WHERE id = (SELECT c.relationship_id FROM conversations c WHERE c.id = (SELECT conversation_id FROM messages WHERE id = ?))
            AND status = ? AND (requester_id = ? OR recipient_id = ?)`,
      )
      .bind(messageId, 'active', userId, userId),
  ]);
  const msg = message.results?.[0] as { conversation_id: string; content: string } | undefined;
  if (!msg) throw new ClaudeContextError('Message not found', 404);
  if (!conversation.results?.[0]) throw new ClaudeContextError('Conversation not found', 404);
  if (!relationship.results?.[0]) throw new ClaudeContextError('Access denied', 403);
  const chatContext = await getChatContext(env.DB, msg.conversation_id, userId);
  return { content: msg.content, chatContext };
}

/** Discuss with Claude's conversation: the history (its first turn sent as the learner's), the question last. */
export function discussTurns(question: string, history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>): ChatTurn[] {
  return [...(history ?? []).map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: question }];
}

/** The cards Claude proposed (the last create_flashcards call), for the app's review sheet. */
export function proposedFlashcards(actions: readonly ToolAction[]): GeneratedNote[] | null {
  let flashcards: GeneratedNote[] | null = null;
  for (const a of actions) {
    if (a.tool !== 'create_flashcards') continue;
    const list = (a.input as { flashcards?: unknown }).flashcards;
    if (list && Array.isArray(list)) flashcards = list as GeneratedNote[];
  }
  return flashcards;
}

export const chatMessageContext: ContextProvider<'chat_message', ChatMessageData> = {
  kind: 'chat_message',
  surface: 'discuss',
  policy: 'chat',
  maxTokens: DISCUSS_MAX_TOKENS,
  maxRounds: 5,
  load: async (env, ctx, input) =>
    ctx.message ? { content: ctx.message.content, chatContext: ctx.message.chat_context } : loadDiscussedMessage(env, ctx.message_id, input.userId),
  persona: () => `${DISCUSS_MESSAGE_SYSTEM_PROMPT}\n\n${CHAT_TOOL_RULE}`,
  learner: () => '',
  systemBlock: () => '',
  frameFirstTurn: (d, content) =>
    `The user is looking at this message from a conversation:\n\n"${d.content}"\n\nConversation context:\n${d.chatContext}\n\nUser's question: ${content}`,
  tools: () => CHAT_MESSAGE_TOOLS,
  toolContext: (_d, input) => ({ deckId: '', bumpSource: input.bumpSource ?? 'chat_discuss' }),
  deferredAck: () => 'Flashcards will be shown to the user for review',
  finish: (text) => text,
};
