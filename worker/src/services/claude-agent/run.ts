/**
 * The run loop of a Claude chat turn — `WorkerRuntime`, today's implementation of the `AgentRuntime`
 * seam (types.ts): call the model, run the tools it asked for, repeat until it stops asking or the
 * round cap is reached.
 *
 * Per tool call (kinds from tools/registry.ts):
 * - `read` → executed now, its result goes back to the model, recorded in `readOnlyToolCalls`;
 * - `lesson` (create_custom_lesson) → the spec validated now: problems go back to the model so it can
 *   repair it in the same turn, a valid spec is collected as a `ToolAction`;
 * - `write` → collected as a `ToolAction` for the caller to apply; the model hears the context's ack;
 * - a name the context may not use → an error result, never run, never collected.
 *
 * Also here: `applyCheckpointed`, the checkpoint rule of background replies (coach-replies.ts): the
 * answer + its actions are saved BEFORE any action runs and `applied` after each, so a redelivery never
 * asks Claude again and never makes a card or a lesson twice.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { validateLessonSpec } from '@shared/lesson';
import { cachedTools, chatTurnParams, ChatTurnMeter } from './model';
import type { AgentRuntime, BoundTool, LoopResult, PreparedTurn, ReadOnlyToolCall, ToolAction, ToolName } from './types';

/**
 * Inline handling of a create_custom_lesson call. The spec is validated HERE, inside the loop, so an
 * invalid spec goes back to the model as an error tool result and it can repair and retry in the same
 * conversation (by the time the caller applies actions the loop is over, so a rejected lesson would be
 * lost). Only a valid spec is collected.
 */
export function handleCustomLessonToolUse(block: Anthropic.ToolUseBlock, collected: ToolAction[]): Anthropic.ToolResultBlockParam {
  const errors = validateLessonSpec(block.input);
  if (errors.length > 0) {
    return {
      type: 'tool_result' as const,
      tool_use_id: block.id,
      is_error: true,
      content: JSON.stringify({
        success: false,
        problems: errors,
        message: 'Lesson spec invalid — fix these problems and call create_custom_lesson again.',
      }),
    };
  }
  collected.push({ tool: 'create_custom_lesson', input: block.input as Record<string, unknown> });
  return {
    type: 'tool_result' as const,
    tool_use_id: block.id,
    content: JSON.stringify({
      success: true,
      message: "Lesson validated — it will be created and mixed into the user's next study session.",
    }),
  };
}

/** The loop. Exported for tests; production goes through `WorkerRuntime`. */
export async function runToolLoop(turn: PreparedTurn): Promise<LoopResult> {
  const byName = new Map<string, BoundTool>(turn.tools.map((t) => [t.name, t]));
  const tools = cachedTools(turn.tools.map((t) => t.schema));
  const messages: Anthropic.MessageParam[] = turn.messages.slice();
  const toolActions: ToolAction[] = [];
  const readOnlyToolCalls: ReadOnlyToolCall[] = [];
  const textParts: string[] = [];
  const meter = new ChatTurnMeter(turn.surface, turn.userId);
  let rounds = 0;

  for (let i = 0; i < turn.maxRounds; i++) {
    const response = await turn.client.messages.create(
      chatTurnParams({ system: turn.system, tools, messages, maxTokens: turn.maxTokens, policy: turn.policy }),
    );
    meter.add(response);
    rounds++;

    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
        // A write tool is collected in the order the model called it; a lesson only once its spec
        // passes (below), as before the harness.
        if (byName.get(block.name)?.kind === 'write') {
          toolActions.push({ tool: block.name as ToolName, input: block.input as Record<string, unknown> });
        }
      }
    }

    if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      await turn.onRound?.({ round: rounds, messages, toolActions, readOnlyToolCalls });
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const tool = byName.get(block.name);
      const input = block.input as Record<string, unknown>;
      if (!tool) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: JSON.stringify({ error: `Unknown tool: ${block.name}` }) });
      } else if (tool.kind === 'read' && tool.execute) {
        const result = await tool.execute(input);
        readOnlyToolCalls.push({ tool: block.name, input, result });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } else if (tool.kind === 'lesson') {
        toolResults.push(handleCustomLessonToolUse(block, toolActions));
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: true, message: turn.deferredAck(block.name) }) });
      }
    }

    messages.push({ role: 'user', content: toolResults });
    await turn.onRound?.({ round: rounds, messages, toolActions, readOnlyToolCalls });
  }

  meter.finish();
  return { text: textParts.join('\n'), toolActions, readOnlyToolCalls, rounds };
}

/** Today's runtime: the loop above, in the Worker that took the request (or the queue consumer). */
export const WorkerRuntime: AgentRuntime = { runTurn: runToolLoop };

// ---------- Checkpointed actions (background replies) ----------

export interface ActionCheckpoint<A, R> {
  answer: string;
  actions: A[];
  /** How many of `actions` already ran (their results are in `results`). */
  applied: number;
  results: R[];
}

/**
 * Applies the checkpoint's remaining actions one by one, saving after each: a redelivery resumes after
 * the last applied action and never runs one twice. The caller saved the checkpoint (answer + actions)
 * before the first call.
 */
export async function applyCheckpointed<A, R>(
  cp: ActionCheckpoint<A, R>,
  apply: (action: A) => Promise<R>,
  save: (cp: ActionCheckpoint<A, R>) => Promise<void>,
): Promise<ActionCheckpoint<A, R>> {
  while (cp.applied < cp.actions.length) {
    cp.results.push(await apply(cp.actions[cp.applied]));
    cp.applied += 1;
    await save(cp);
  }
  return cp;
}
