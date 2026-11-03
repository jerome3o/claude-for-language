/**
 * The types of the Claude agent harness (services/claude-agent, CLAUDE.md "Claude agent harness").
 *
 * Every Claude chat turn is described by a `ClaudeContext` (WHERE the learner is talking to Claude),
 * a `TurnInput` (the conversation so far + the turn's language) and runs through `runClaudeTurn`:
 *
 *   ContextProvider.load  → one D1 batch (+ the ownership check)
 *   prompt.ts             → system blocks (persona, learner, context) + tools + messages, cache-friendly
 *   AgentRuntime.runTurn  → the model + tool loop (run.ts today; the seam a future harness implements)
 *   ContextProvider.finish → the stored answer
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AskLanguage } from '@shared/study/askClaude';
import type { Env, Note } from '../../types';
import type { ChatTurnSurface, ModelPolicyName } from './model';

// ---------- The context descriptor ----------

/**
 * Where a turn happens. Serializable refs (ids); the optional preloaded fields carry data a route has
 * already loaded AND checked the ownership of, so the provider skips its lookup.
 */
export type ClaudeContext =
  /** A chat about anything (the Coach's "💬 Ask Claude" chat; later the Chats composer). */
  | { kind: 'general' }
  /** Ask Claude on a study card. */
  | {
      kind: 'card';
      note_id: string;
      /** The typed answer of a meaning → hanzi / audio → hanzi card, when the learner asks right after it. */
      typed?: { answer: string; correct?: string };
      /** The note, already loaded with the owner's id (skips the lookup). */
      note?: Note;
    }
  /** A Sentence Coach follow-up about a checked / explained / translated sentence (the history carries the sentence). */
  | { kind: 'coach'; conversation_id?: string }
  /** Discuss with Claude about one chat message. */
  | {
      kind: 'chat_message';
      message_id: string;
      /** The message and its surrounding chat, already loaded with the caller's access checked. */
      message?: { content: string; chat_context: string };
    };

export type ContextKind = ClaudeContext['kind'];
export type ContextOf<K extends ContextKind> = Extract<ClaudeContext, { kind: K }>;

export const CONTEXT_KINDS: readonly ContextKind[] = ['general', 'card', 'coach', 'chat_message'];

// ---------- A turn ----------

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TurnInput {
  userId: string;
  /** The whole conversation so far, oldest first; the LAST turn is the learner's new message. */
  turns: ChatTurn[];
  /** The answer language (card + general; the persona picks its rules by it). Default 'en'. */
  language?: AskLanguage;
  /** A known-words sample already in hand (general); else the provider looks it up when it needs one. */
  knownWords?: string[];
  /** Where a bump_cards call is recorded as coming from (else the context's default). */
  bumpSource?: string;
}

export interface TurnOptions {
  /** A stand-in model (tests, a future harness's proxy). Default: `createAnthropicClient(env.ANTHROPIC_API_KEY)`. */
  client?: Pick<Anthropic, 'messages'>;
  /** The loop runner (default: the Worker runtime, run.ts). */
  runtime?: AgentRuntime;
  /** Called after every model round with the transcript so far (checkpoints). */
  onRound?: RoundHook;
  /**
   * Stream the reply (the Anthropic streaming API inside the runtime): the hooks get the text as it
   * comes. Unset = one non-streamed call per round, exactly as before (the inline routes).
   */
  stream?: TurnStreamHooks;
  /** `server.claude_turn` `inline`: the reply started in the request that asked (not a queue delivery). */
  inline?: boolean;
}

/** What a streamed turn reports while it runs (thread-turn.ts → live.ts → ChatHub `claude_turn`). */
export interface TurnStreamHooks {
  /** The WHOLE answer text so far (every round's text, joined like the final answer). */
  onText(text: string): void;
  /** A read tool is about to run (the app says "Looking through your cards…"). */
  onTool?(tool: string): void;
  /** Any stream event (keeps the runner's lease alive while the model writes a long tool input). */
  onActivity?(): void;
}

export type ToolName =
  | 'edit_current_card'
  | 'create_flashcards'
  | 'delete_current_card'
  | 'create_custom_lesson'
  | 'search_cards'
  | 'list_conversations'
  | 'get_deck_info'
  | 'get_note_cards'
  | 'get_note_history'
  | 'get_deck_progress'
  | 'get_due_cards'
  | 'get_overall_stats'
  | 'bump_cards'
  | 'list_student_decks';

/** A mutating tool call the loop did NOT run: the caller applies it (route / coach-replies with a checkpoint). */
export interface ToolAction {
  tool: ToolName;
  input: Record<string, unknown>;
}

/** A tool the loop ran itself (reads, and bump_cards — idempotent and cheap). */
export interface ReadOnlyToolCall {
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface TurnResult {
  /** The answer as the context stores it (a Chinese card answer as plain text, …). */
  answer: string;
  language?: AskLanguage;
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
  /** Model rounds the turn took. */
  rounds: number;
}

// ---------- Tools ----------

/** What a tool's executor may touch: the learner's own rows, nothing else. */
export interface ToolContext {
  db: D1Database;
  userId: string;
  /** The deck the turn is about ('' when none). */
  deckId: string;
  bumpSource: string;
  context: ContextKind;
}

/**
 * How the loop treats a call:
 * - `read`: run inline, the result goes back to the model (bump_cards too — idempotent, cheap);
 * - `write`: collected as a `ToolAction` for the caller to apply; the model gets the context's ack;
 * - `lesson`: create_custom_lesson — the spec is validated inline (errors go back to the model to
 *   repair), a valid one is collected like a write.
 */
export type ToolKind = 'read' | 'write' | 'lesson';

/** The bound tool a runtime sees: its schema for the model, and how to run it. */
export interface BoundTool {
  name: ToolName;
  kind: ToolKind;
  schema: Anthropic.Tool;
  execute?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ---------- Context providers ----------

export type AgentEnv = Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'> & Partial<Env>;

/** The learner block of the system prompt (per user; changes at most daily — cached). */
export interface LearnerInfo {
  knownWords: string[];
}

/**
 * One file per context (contexts/*.ts). Adding a context = a provider + its tools' allow-list
 * (tools/registry.ts) + an entry in contexts/index.ts.
 *
 * PRIVACY: a provider reads only the learner's own data. Never `student_profiles` (the tutor's private
 * note) — tested in __tests__/privacy.test.ts.
 */
export interface ContextProvider<K extends ContextKind = ContextKind, D = unknown> {
  kind: K;
  /** `server.claude_turn` surface (analytics values kept from before the harness). */
  surface: ChatTurnSurface;
  policy: ModelPolicyName;
  /** Output budget (default: the policy's). */
  maxTokens?: number;
  /** Most model rounds of the tool loop. */
  maxRounds: number;
  /** Ownership check + data. ONE D1 batch where it can; throws `ClaudeContextError` (404 / 403). */
  load(env: AgentEnv, ctx: ContextOf<K>, input: TurnInput): Promise<D>;
  /** The STATIC system block: persona + language + tool rules. Same for everyone (cached). */
  persona(data: D, input: TurnInput): string;
  /** The learner block ('' = none; cached). */
  learner(data: D, input: TurnInput): string;
  /** The context block in the system prompt ('' = none; after the cached blocks). */
  systemBlock(data: D, input: TurnInput): string;
  /** The first user message as sent (the context's framing + the learner's first question); none = as it is. */
  frameFirstTurn?(data: D, content: string): string;
  /** The tools this context may use, in the order the model sees them. */
  tools(data: D): readonly ToolName[];
  /** The executor's context (deck, bump source). */
  toolContext(data: D, input: TurnInput): Omit<ToolContext, 'db' | 'userId' | 'context'>;
  /** What the model hears back from a `write` tool the caller applies later. */
  deferredAck(tool: string): string;
  /** The answer as stored, from the turn's text (throw to fail the turn). */
  finish(text: string, input: TurnInput): string;
  /** Quick-question chips for the composer (a later PR). */
  chips?(data: D, input: TurnInput): string[];
}

/** A context the caller may not use (or that doesn't exist). The route answers with `status`. */
export class ClaudeContextError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
    this.name = 'ClaudeContextError';
  }
}

// ---------- The runtime seam ----------

/** A turn ready to run: everything a loop needs, no D1 or provider left to consult. */
export interface PreparedTurn {
  surface: ChatTurnSurface;
  userId: string;
  policy: ModelPolicyName;
  maxTokens?: number;
  maxRounds: number;
  system: Anthropic.TextBlockParam[];
  /** The tools, in order; the last carries the cache breakpoint when sent. */
  tools: BoundTool[];
  messages: Anthropic.MessageParam[];
  deferredAck(tool: string): string;
  client: Pick<Anthropic, 'messages'>;
  onRound?: RoundHook;
  /** Set = stream (TurnOptions.stream). */
  stream?: TurnStreamHooks;
  inline?: boolean;
}

/** What a runtime returns: the text of every round, joined, and the tool calls. */
export interface LoopResult {
  text: string;
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
  rounds: number;
}

export interface RoundState {
  round: number;
  messages: Anthropic.MessageParam[];
  toolActions: ToolAction[];
  readOnlyToolCalls: ReadOnlyToolCall[];
}

export type RoundHook = (state: RoundState) => void | Promise<void>;

/**
 * THE seam: a future harness (the Claude Agent SDK in a Container, a per-thread Durable Object, …)
 * implements this and is chosen in index.ts. Prompt assembly, contexts and the tool registry stay.
 */
export interface AgentRuntime {
  runTurn(turn: PreparedTurn): Promise<LoopResult>;
}
