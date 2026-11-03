/**
 * The model call of a Claude chat turn (services/claude-agent): the model policy, the request shape and
 * the timing of a reply ("Calling Claude reliably" in CLAUDE.md):
 * - `MODEL_POLICY.chat` = `SONNET_MODEL` with thinking OFF: the first words come fast and `max_tokens`
 *   is all answer (a custom-lesson spec still fits);
 * - prompt caching on the stable prefix (render order tools → system → messages): the last tool
 *   definition, the cached system blocks (static rules first, then the per-learner block), and the tail
 *   of the conversation so round 2+ of a tool loop (and the next turn within 5 min) reads the rounds
 *   before it. At most 4 breakpoints per request — tools 1 + system ≤ 2 + tail 1;
 * - `server.claude_turn` (ids / enums / counts only) once the agent loop is done.
 * (Was services/chat-turn.ts, which now re-exports this module.)
 */
import Anthropic from '@anthropic-ai/sdk';
import { HAIKU_MODEL, SONNET_MODEL, modelTier } from '../models';
import { trackServer } from '../analytics/server-events';

/** Fits a full custom-lesson spec (thinking is off, so it is all answer). */
export const CHAT_TURN_MAX_TOKENS = 12000;

/**
 * The model policy of a chat turn — the ONE place the model / thinking of every Claude chat is chosen.
 * `chat`: `SONNET_MODEL` with thinking OFF ("Calling Claude reliably" in CLAUDE.md): the first words
 * come fast and `max_tokens` is all answer. Later policies (role-play, a background summary, an opt-in
 * `deep` turn on `OPUS_MODEL` with `withEffort`) are added here, never at a call site. `summary` /
 * `digest` are the memory's background notes (`HAIKU_MODEL` via `structuredCall`).
 */
export const MODEL_POLICY = {
  chat: { model: SONNET_MODEL, thinking: { type: 'disabled' as const }, maxTokens: CHAT_TURN_MAX_TOKENS },
  /**
   * A role-play line (context `practice`): `SONNET_MODEL`, thinking OFF (a quick, natural reply — a
   * person talking, not an essay); a short budget — a line or two, or a short bit of help.
   */
  practice: { model: SONNET_MODEL, thinking: { type: 'disabled' as const }, maxTokens: 1500 },
  /** Claude memory (memory.ts): a thread's rolling summary — background, `structuredCall`. */
  summary: { model: HAIKU_MODEL, thinking: { type: 'disabled' as const }, maxTokens: 400 },
  /** Claude memory: the learner digest — background (daily cron / after 5 new summaries), `structuredCall`. */
  digest: { model: HAIKU_MODEL, thinking: { type: 'disabled' as const }, maxTokens: 1200 },
} as const;

export type ModelPolicyName = keyof typeof MODEL_POLICY;

/**
 * The Anthropic client of a turn. Its own export so tests (and a future harness) swap it in one place:
 * `runClaudeTurn` calls it from index.ts, never from this module.
 */
export function createAnthropicClient(apiKey: string): Pick<Anthropic, 'messages'> {
  return new Anthropic({ apiKey });
}

const EPHEMERAL = { type: 'ephemeral' } as const;

export type ChatTurnSurface = 'ask' | 'coach' | 'coach_ask' | 'discuss' | 'practice' | 'reader' | 'exercise';

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
  policy?: ModelPolicyName;
}): Anthropic.MessageCreateParamsNonStreaming {
  const policy = MODEL_POLICY[opts.policy ?? 'chat'];
  return {
    model: policy.model,
    max_tokens: opts.maxTokens ?? policy.maxTokens,
    thinking: policy.thinking,
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
  private firstTokenAt: number | null = null;

  constructor(
    private readonly surface: ChatTurnSurface,
    private readonly userId?: string | null,
    private readonly opts: { inline?: boolean } = {},
  ) {}

  /** The first streamed text of the reply (once; a non-streamed reply never calls it). */
  firstToken(now = Date.now()): void {
    if (this.firstTokenAt === null) this.firstTokenAt = now;
  }

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
  props(now = Date.now()): Record<string, number | string | boolean> {
    return {
      surface: this.surface,
      model_tier: modelTier(this.model),
      ...(this.firstTokenAt !== null ? { first_token_ms: this.firstTokenAt - this.started } : {}),
      ...(this.opts.inline !== undefined ? { inline: this.opts.inline } : {}),
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
