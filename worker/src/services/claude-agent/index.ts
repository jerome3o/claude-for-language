/**
 * The Claude agent harness — THE one place every Claude chat turn goes through (CLAUDE.md "Claude
 * agent harness"): Ask Claude on a card, Sentence Coach follow-ups, the Coach's "💬 Ask Claude" chat
 * and Discuss with Claude.
 *
 *   runClaudeTurn(env, ctx, input)
 *     1. provider = contexts/<kind>.ts            load: ownership check + data (one D1 batch)
 *     2. prompt.ts + memory.ts                    persona → learner + memory → context blocks, framed
 *                                                 (and, when long, compacted) history
 *     3. tools/registry.ts                        the context's allowed tools, bound to the learner
 *     4. runtime.runTurn(prepared)                run.ts today (model.ts policy + the tool loop)
 *     5. provider.finish                          the answer as the context stores it
 *
 * Swapping the harness (Agent SDK in a Container, a per-thread Durable Object, streaming…) = a new
 * `AgentRuntime` passed here / made the default below; contexts, prompts and tools stay.
 */
import { createAnthropicClient } from './model';
import { compactMessages, loadTurnMemory, memoryBlock } from './memory';
import { assembleMessages, assembleSystem } from './prompt';
import { WorkerRuntime } from './run';
import { bindTools } from './tools/registry';
import { providerFor } from './contexts';
import type { AgentEnv, AgentRuntime, ClaudeContext, PreparedTurn, TurnInput, TurnOptions, TurnResult } from './types';

export * from './types';
export { CONTEXT_PROVIDERS, providerFor } from './contexts';
export { askTurns } from './contexts/card';
export { discussTurns, proposedFlashcards } from './contexts/chat_message';
export { TOOL_REGISTRY, toolAllowed, toolSchema, bindTools, FLASHCARD_ITEM_SCHEMA, BUMP_CARDS_TOOL } from './tools/registry';
export { executeBumpCardsTool } from './tools/read';
export { WorkerRuntime, runToolLoop, applyCheckpointed, handleCustomLessonToolUse, type ActionCheckpoint } from './run';
export { MODEL_POLICY, createAnthropicClient } from './model';
export { rememberThread, rememberInBackground, runClaudeMemoryCron, summarizeThread, rebuildLearnerDigest, memoryBlock, compactMessages } from './memory';

/** The runtime every turn uses unless the caller passes one. */
export const defaultRuntime: AgentRuntime = WorkerRuntime;

/**
 * Builds a turn without running it: the provider's data, the system blocks, the bound tools and the
 * messages. Exported for tests and for a runtime that wants the prepared turn itself.
 */
export async function prepareClaudeTurn(env: AgentEnv, ctx: ClaudeContext, input: TurnInput, opts: TurnOptions = {}): Promise<PreparedTurn> {
  const provider = providerFor(ctx.kind);
  const client = opts.client ?? (env.ANTHROPIC_API_KEY ? createAnthropicClient(env.ANTHROPIC_API_KEY) : null);
  if (!client) throw new Error('AI is not configured');
  // The context's data and the learner's memory (+ the thread's summary) side by side.
  const [data, memory] = await Promise.all([provider.load(env, ctx as never, input), loadTurnMemory(env.DB, input.userId, input.threadId)]);
  const toolCtx = provider.toolContext(data, input);
  // A long thread: its first message + summary + the last turns (memory.ts `compactMessages`).
  const history = compactMessages(assembleMessages(input.turns, provider.frameFirstTurn ? (content) => provider.frameFirstTurn!(data, content) : undefined), {
    summary: memory.threadSummary,
    threadId: input.threadId,
  });
  const context = [provider.systemBlock(data, input), history.note].filter((b) => b && b.trim()).join('\n\n');
  return {
    surface: provider.surface,
    userId: input.userId,
    policy: provider.policy,
    maxTokens: provider.maxTokens,
    maxRounds: provider.maxRounds,
    system: assembleSystem({ persona: provider.persona(data, input), learner: provider.learner(data, input), memory: memoryBlock(memory.memory), context }),
    tools: bindTools(ctx.kind, provider.tools(data), { db: env.DB, userId: input.userId, context: ctx.kind, threadId: input.threadId ?? null, ...toolCtx }),
    messages: history.messages,
    deferredAck: (tool) => provider.deferredAck(tool),
    client,
    onRound: opts.onRound,
    ...(opts.stream ? { stream: opts.stream } : {}),
    ...(opts.inline !== undefined ? { inline: opts.inline } : {}),
  };
}

/**
 * One Claude chat turn: the answer, the write actions for the caller to apply, the read tools that ran.
 * Throws `ClaudeContextError` (404 / 403) when the context isn't the caller's, and the model's errors
 * as they come (the caller decides: retry, 500, a failed row).
 */
export async function runClaudeTurn(env: AgentEnv, ctx: ClaudeContext, input: TurnInput, opts: TurnOptions = {}): Promise<TurnResult> {
  const provider = providerFor(ctx.kind);
  const prepared = await prepareClaudeTurn(env, ctx, input, opts);
  const out = await (opts.runtime ?? defaultRuntime).runTurn(prepared);
  return {
    answer: provider.finish(out.text, input),
    ...(input.language ? { language: input.language } : {}),
    toolActions: out.toolActions,
    readOnlyToolCalls: out.readOnlyToolCalls,
    rounds: out.rounds,
  };
}
