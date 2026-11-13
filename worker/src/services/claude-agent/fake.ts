/**
 * The E2E_TEST_MODE stand-in model of Claude threads (CLAUDE.md "E2E is hermetic": checked FIRST,
 * whatever key is set). A client with the two calls the harness makes: `messages.stream` streams the
 * answer in THREE chunks a moment apart (so a spec sees the reply grow), `messages.create` returns it
 * whole. Also used by the unit tests of the turn runner.
 *
 * One tool, so a spec can see a card tool reach the device: on a card turn (edit_current_card among
 * the tools) whose question asks for a fun fact (the "Add a fun fact" chip, 小知识 / "fun fact"), the
 * first round calls edit_current_card with `FAKE_FUN_FACT`; the round after the tool result is the
 * usual streamed answer.
 *
 * A second one: in any context offering create_flashcards, a question asking for a card (卡片 /
 * "make a card") makes `FAKE_CARDS[0]` — "two cards" / 两张 makes both — so a spec can tap the
 * "✓ Added" line's word into the explorer (docs/CHAT.md "Cards Claude added").
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AskLanguage } from '@shared/study/askClaude';

export const FAKE_STREAM_CHUNKS: Record<AskLanguage, readonly string[]> = {
  zh: ['这是一个好问题。', '\n我用简单的中文回答你。', '\n有不懂的词，你可以点一下。'],
  en: ['(E2E) Claude streams ', 'this answer ', 'in three parts.'],
};

/** A role-play line (a practice thread's persona — the waiter of "在饭店点菜"). */
export const FAKE_PRACTICE_CHUNKS: readonly string[] = ['你好！欢迎光临。', '请问几位？', '这是菜单，您想吃点什么？'];

export const FAKE_STREAM_MODEL = 'e2e-fake-model';

/** What the stand-in writes into the card's notes when asked for a fun fact. */
export const FAKE_FUN_FACT = '(E2E) 小知识: Claude added this fun fact.';

/** The cards the stand-in makes when asked for a card (card-standard complete, so the content service takes them). */
export const FAKE_CARDS = [
  { hanzi: '机会', pinyin: 'jīhuì', english: 'opportunity', fun_facts: '机 (jī) machine, moment + 会 (huì) meeting, chance → a moment that comes together: an opportunity.', sentence_clue: '这是一个好机会。', sentence_clue_pinyin: 'Zhè shì yí gè hǎo jīhuì.', sentence_clue_translation: 'This is a good opportunity.' },
  { hanzi: '难得', pinyin: 'nándé', english: 'rare, hard to come by', fun_facts: '难 (nán) hard + 得 (dé) to get → hard to get: rare, precious.', sentence_clue: '这样的机会很难得。', sentence_clue_pinyin: 'Zhèyàng de jīhuì hěn nándé.', sentence_clue_translation: 'A chance like this is rare.' },
] as const;

type Params = { tools?: Array<{ name?: string }>; messages?: Array<{ role: string; content: unknown }> };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n');
}

/** The fun-fact tool call, when this round should make it (see the file comment). */
function funFactToolUse(params: Params | undefined): Anthropic.Message | null {
  if (!params?.tools?.some((t) => t.name === 'edit_current_card')) return null;
  const messages = params.messages ?? [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  // Already answered with a tool result: this is the round after it.
  if (Array.isArray(last.content) && last.content.some((b) => (b as { type?: string })?.type === 'tool_result')) return null;
  const text = textOf(last.content);
  if (!/小知识|fun fact/i.test(text)) return null;
  const m = message('', 'tool_use');
  m.content = [{ type: 'tool_use', id: `toolu_e2e_${Math.random().toString(36).slice(2, 10)}`, name: 'edit_current_card', input: { fun_facts: FAKE_FUN_FACT } } as Anthropic.ToolUseBlock];
  return m;
}

/** The card-making tool call, when this round should make it (see the file comment). */
function cardsToolUse(params: Params | undefined): Anthropic.Message | null {
  if (!params?.tools?.some((t) => t.name === 'create_flashcards')) return null;
  const messages = params.messages ?? [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  if (Array.isArray(last.content) && last.content.some((b) => (b as { type?: string })?.type === 'tool_result')) return null;
  const text = textOf(last.content);
  if (!/卡片|make (a |two )?cards?|flashcard/i.test(text)) return null;
  const flashcards = /两张|two cards/i.test(text) ? [...FAKE_CARDS] : [FAKE_CARDS[0]];
  const m = message('', 'tool_use');
  m.content = [{ type: 'tool_use', id: `toolu_e2e_${Math.random().toString(36).slice(2, 10)}`, name: 'create_flashcards', input: { flashcards } } as Anthropic.ToolUseBlock];
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type StreamListener = (event: Anthropic.MessageStreamEvent, snapshot: Anthropic.Message) => void;

function message(text: string, stop: Anthropic.Message['stop_reason']): Anthropic.Message {
  return {
    id: `msg_e2e_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model: FAKE_STREAM_MODEL,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
  } as Anthropic.Message;
}

class FakeMessageStream {
  private readonly listeners: StreamListener[] = [];

  constructor(private readonly chunks: readonly string[], private readonly delayMs: number, private readonly toolUse: Anthropic.Message | null = null) {}

  on(event: string, listener: StreamListener): this {
    if (event === 'streamEvent') this.listeners.push(listener);
    return this;
  }

  async finalMessage(): Promise<Anthropic.Message> {
    if (this.toolUse) {
      if (this.delayMs > 0) await sleep(this.delayMs);
      return this.toolUse;
    }
    const snapshot = message('', null);
    const block = snapshot.content[0] as Anthropic.TextBlock;
    for (const [i, chunk] of this.chunks.entries()) {
      if (i > 0 || this.delayMs > 0) await sleep(this.delayMs);
      block.text += chunk;
      const event = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } } as Anthropic.MessageStreamEvent;
      for (const l of this.listeners) l(event, snapshot);
    }
    snapshot.stop_reason = 'end_turn';
    return snapshot;
  }
}

/** The stand-in client: the answer in the turn's language (or a role-play line), `delayMs` between chunks. */
export function fakeStreamingClient(language: AskLanguage = 'zh', delayMs = 250, variant?: 'practice'): Pick<Anthropic, 'messages'> {
  const chunks = variant === 'practice' ? FAKE_PRACTICE_CHUNKS : FAKE_STREAM_CHUNKS[language];
  return {
    messages: {
      create: async (params: Params) => funFactToolUse(params) ?? cardsToolUse(params) ?? message(chunks.join(''), 'end_turn'),
      stream: (params: Params) => new FakeMessageStream(chunks, delayMs, funFactToolUse(params) ?? cardsToolUse(params)),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
