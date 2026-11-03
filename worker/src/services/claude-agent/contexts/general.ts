/**
 * Context `general` — a chat with Claude about anything: today the Sentence Coach's "💬 Ask Claude"
 * chat (services/claude-chat.ts, docs/CHAT.md "Ask Claude chat"); later the Chats tab's composer.
 *
 * Simple, graded Chinese by default (the immersion rules + the learner's known-words sample) or English
 * Markdown. Tools: only the memory's look-ups (search_my_chats / read_chat — the learner's earlier chats);
 * cards are made from the chat afterwards ("Make flashcards from this chat").
 */
import type { AskLanguage } from '@shared/study/askClaude';
import { StructuredCallError } from '../../structured-call';
import { sampleKnownWords } from '../learner';
import { buildClaudeChatSystemBlocks } from '../persona';
import type { ContextProvider, ToolName } from '../types';

/** A chat reply's output budget (thinking is off, so it is all answer). */
export const CLAUDE_CHAT_MAX_TOKENS = 4000;

/** The general chat's tools: the memory's look-ups only. */
export const GENERAL_TOOLS: readonly ToolName[] = ['search_my_chats', 'read_chat'];

interface GeneralData {
  language: AskLanguage;
  knownWords: string[];
}

export const generalContext: ContextProvider<'general', GeneralData> = {
  kind: 'general',
  surface: 'coach_ask',
  policy: 'chat',
  maxTokens: CLAUDE_CHAT_MAX_TOKENS,
  // A look-up or two in the learner's earlier chats, then the answer.
  maxRounds: 3,
  async load(env, _ctx, input) {
    const language: AskLanguage = input.language ?? 'zh';
    const knownWords = input.knownWords ?? (language === 'zh' ? await sampleKnownWords(env.DB, input.userId) : []);
    return { language, knownWords };
  },
  persona: (d) => buildClaudeChatSystemBlocks(d)[0],
  learner: (d) => buildClaudeChatSystemBlocks(d)[1],
  systemBlock: () => '',
  tools: () => GENERAL_TOOLS,
  toolContext: () => ({ deckId: '', bumpSource: 'claude_chat' }),
  deferredAck: (tool) => `Tool ${tool} is not available here`,
  finish(text) {
    const answer = text.trim();
    // An empty answer (cut off / declined): worth another delivery.
    if (!answer) throw new StructuredCallError('Claude gave an empty answer', true);
    return answer;
  },
};
