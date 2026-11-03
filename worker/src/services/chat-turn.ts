/**
 * The request shape and the timing of a Claude CHAT reply — Ask Claude on a card
 * (`askAboutNoteWithTools`), Sentence Coach follow-ups (`coachChatWithTools`), the Coach's "💬 Ask Claude" chat
 * (`defaultCoachAskReply`, services/claude-chat.ts) and Discuss
 * with Claude (`discussMessage`):
 * - `SONNET_MODEL` with thinking OFF ("Calling Claude reliably" in CLAUDE.md): the first words
 *   come fast and `max_tokens` is all answer (a custom-lesson spec still fits);
 * - prompt caching on the stable prefix (render order tools → system → messages): the last
 *   tool definition, each system block (static rules first, then the per-user block), and the
 *   tail of the conversation so round 2+ of a tool loop (and the next turn within 5 min) reads
 *   the rounds before it. At most 4 breakpoints per request — tools 1 + system ≤ 2 + tail 1;
 * - `server.claude_turn` (ids / enums / counts only) once the agent loop is done.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { SONNET_MODEL, modelTier } from './models';
import { trackServer } from './analytics/server-events';

/**
 * Every chat prompt carries this (thinking is off: a tool call must be a real tool call, never
 * written out in the text).
 */
export const CHAT_TOOL_RULE = 'When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags in your response.';

/** Fits a full custom-lesson spec (thinking is off, so it is all answer). */
export const CHAT_TURN_MAX_TOKENS = 12000;

const EPHEMERAL = { type: 'ephemeral' } as const;

export type ChatTurnSurface = 'ask' | 'coach' | 'coach_ask' | 'discuss';

/** The tool list with a cache breakpoint on its last tool (caches every definition). */
export function cachedTools(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
}

/**
 * System blocks, each with a cache breakpoint (at most two: the static rules, then the
 * per-user block). Empty blocks are dropped.
 */
export function cachedSystem(...blocks: string[]): Anthropic.TextBlockParam[] {
  const kept = blocks.filter((b) => b && b.trim());
  if (kept.length > 2) throw new Error('cachedSystem: at most two cached system blocks');
  return kept.map((text) => ({ type: 'text' as const, text, cache_control: EPHEMERAL }));
}

/**
 * A copy of `messages` whose LAST message's last block carries a cache breakpoint. The
 * caller's array is never touched, so earlier rounds don't keep their breakpoints (more than
 * four is a 400).
 */
export function withCachedTail(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  if (typeof last.content === 'string') {
    if (!last.content) return out;
    out[out.length - 1] = { ...last, content: [{ type: 'text', text: last.content, cache_control: EPHEMERAL }] };
    return out;
  }
  if (!Array.isArray(last.content) || last.content.length === 0) return out;
  const blocks = last.content.slice();
  const tail = blocks[blocks.length - 1];
  // Thinking blocks can't carry cache_control (and never occur here: thinking is off).
  if (tail.type === 'thinking' || tail.type === 'redacted_thinking') return out;
  blocks[blocks.length - 1] = { ...tail, cache_control: EPHEMERAL } as typeof tail;
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

/** One model round of a chat reply. */
export function chatTurnParams(opts: {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: SONNET_MODEL,
    max_tokens: opts.maxTokens ?? CHAT_TURN_MAX_TOKENS,
    thinking: { type: 'disabled' },
    system: opts.system,
    ...(opts.tools.length ? { tools: opts.tools } : {}),
    messages: withCachedTail(opts.messages),
  };
}

/** Sums the rounds of one reply and records `server.claude_turn`. */
export class ChatTurnMeter {
  private readonly started = Date.now();
  private rounds = 0;
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private model = SONNET_MODEL;

  constructor(private readonly surface: ChatTurnSurface, private readonly userId?: string | null) {}

  /** After each model round. */
  add(response: { model?: string; usage?: Partial<Anthropic.Usage> | null }): void {
    this.rounds++;
    if (typeof response.model === 'string' && response.model) this.model = response.model;
    const u = response.usage;
    if (!u) return;
    const write = Number(u.cache_creation_input_tokens) || 0;
    this.input += (Number(u.input_tokens) || 0) + write;
    this.output += Number(u.output_tokens) || 0;
    this.cacheRead += Number(u.cache_read_input_tokens) || 0;
    this.cacheWrite += write;
  }

  /** The props `finish` records (exported for tests). */
  props(now = Date.now()): Record<string, number | string> {
    return {
      surface: this.surface,
      model_tier: modelTier(this.model),
      total_ms: now - this.started,
      input_tokens: this.input,
      output_tokens: this.output,
      cache_read_tokens: this.cacheRead,
      cache_write_tokens: this.cacheWrite,
      rounds: this.rounds,
    };
  }

  /** Records the reply (never throws, never blocks). */
  finish(): void {
    const props = this.props();
    console.log(JSON.stringify({ type: 'claude_turn', ...props }));
    void trackServer('server.claude_turn', props, this.userId !== undefined ? { userId: this.userId } : {});
  }
}
