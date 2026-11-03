/**
 * Moved into the Claude agent harness: the model policy + request shape are in
 * `services/claude-agent/model.ts`, the tool rule in `claude-agent/persona.ts`. Kept as a re-export
 * so older imports keep working; new code imports from `./claude-agent`.
 */
export {
  CHAT_TURN_MAX_TOKENS,
  MODEL_POLICY,
  cachedTools,
  cachedSystem,
  withCachedTail,
  chatTurnParams,
  ChatTurnMeter,
  type ChatTurnSurface,
} from './claude-agent/model';
export { CHAT_TOOL_RULE } from './claude-agent/persona';
