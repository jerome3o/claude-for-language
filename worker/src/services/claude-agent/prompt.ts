/**
 * Prompt assembly of a Claude chat turn, in a cache-friendly order (the API renders tools → system →
 * messages, and a cache breakpoint caches everything before it):
 *
 *   tools      the context's tools from the registry, stable order        ← breakpoint on the last one
 *   system[0]  persona + language rules + tool rules + card standard      ← breakpoint (static, everyone)
 *   system[1]  the learner block (known-words sample; per user, ~daily)   ← breakpoint
 *   system[2]  the context block (per thread; '' today — card facts ride in the first user message)
 *   messages   the conversation, the first user turn framed by the context ← breakpoint on the tail
 *
 * The learner block comes BEFORE the context block: it is the more stable of the two (one per user per
 * day vs one per thread), so a new thread still reads the learner block from the cache. At most four
 * breakpoints (tools 1 + system 2 + tail 1); the tail's is added per round (model.ts `chatTurnParams`).
 *
 * PRIVACY: nothing here reads data; the blocks come from the providers, which read the learner's own
 * rows only — never `student_profiles` (__tests__/privacy.test.ts).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { cachedSystem } from './model';
import type { ChatTurn } from './types';

export interface SystemParts {
  persona: string;
  learner: string;
  context: string;
}

/** The system blocks: persona and learner cached (empty ones dropped), the context block after them uncached. */
export function assembleSystem(parts: SystemParts): Anthropic.TextBlockParam[] {
  const system = cachedSystem(parts.persona, parts.learner);
  if (parts.context && parts.context.trim()) system.push({ type: 'text', text: parts.context });
  return system;
}

/**
 * The model messages from the conversation, every turn as it is — except, when the context frames it,
 * the FIRST turn, sent as the learner's: the context's framing + their first question. Roles are not
 * merged here — a caller that needs alternation merges first (claude-chat.ts `coachAskTurns`,
 * coach-replies `buildCoachHistory`).
 */
export function assembleMessages(turns: readonly ChatTurn[], frameFirst?: (content: string) => string): Anthropic.MessageParam[] {
  return turns.map((t, i) => (i === 0 && frameFirst ? { role: 'user' as const, content: frameFirst(t.content) } : { role: t.role, content: t.content }));
}
