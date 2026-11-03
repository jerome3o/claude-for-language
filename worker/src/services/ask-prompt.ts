/**
 * The system prompt of Ask Claude on the study card — moved into the Claude agent harness
 * (`services/claude-agent/persona.ts`, the `card` context in `claude-agent/contexts/card.ts`). Kept as a
 * re-export so older imports keep working.
 */
export {
  ASK_KNOWN_WORDS_MAX,
  GENERAL_IMMERSION_RULES,
  buildAskSystemBlocks,
  buildAskSystemPrompt,
  knownWordsBlock,
  type AskPromptOptions,
} from './claude-agent/persona';
