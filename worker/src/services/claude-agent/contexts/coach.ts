/**
 * Context `coach` — a Sentence Coach follow-up (services/coach-replies.ts, docs/CHAT.md "Chat ↔ Coach"):
 * the learner checked / explained / translated a sentence and asks more about it. The conversation the
 * caller passes already opens with the deck list and the sentence, then the stored analysis
 * (`buildCoachHistory`), so this context loads nothing. Answers in English with pinyin; the tools make
 * cards (collected — coach-replies applies them with its checkpoint), lessons, bumps and look-ups.
 */
import { CHAT_TOOL_RULE, COACH_CHAT_SYSTEM_PROMPT } from '../persona';
import type { ContextProvider, ToolName } from '../types';

/** The coach chat's tools, in the order the model sees them. */
export const COACH_TOOLS: readonly ToolName[] = [
  'bump_cards',
  'create_flashcards',
  'create_custom_lesson',
  'search_cards',
  'get_note_cards',
  'get_note_history',
  'get_overall_stats',
  'search_my_chats',
  'read_chat',
];

export const coachContext: ContextProvider<'coach', Record<string, never>> = {
  kind: 'coach',
  surface: 'coach',
  policy: 'chat',
  maxRounds: 5,
  load: async () => ({}),
  persona: () => `${COACH_CHAT_SYSTEM_PROMPT}\n\n${CHAT_TOOL_RULE}`,
  learner: () => '',
  systemBlock: () => '',
  tools: () => COACH_TOOLS,
  toolContext: (_d, input) => ({ deckId: '', bumpSource: input.bumpSource ?? 'coach_chat' }),
  deferredAck: (tool) => `Tool ${tool} was executed`,
  finish: (text) => text,
};
