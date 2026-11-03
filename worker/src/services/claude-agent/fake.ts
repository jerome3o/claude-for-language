/**
 * The E2E_TEST_MODE stand-in model of Claude threads (CLAUDE.md "E2E is hermetic": checked FIRST,
 * whatever key is set). A client with the two calls the harness makes: `messages.stream` streams the
 * answer in THREE chunks a moment apart (so a spec sees the reply grow), `messages.create` returns it
 * whole. No tools are ever called. Also used by the unit tests of the turn runner.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AskLanguage } from '@shared/study/askClaude';

export const FAKE_STREAM_CHUNKS: Record<AskLanguage, readonly string[]> = {
  zh: ['这是一个好问题。', '\n我用简单的中文回答你。', '\n有不懂的词，你可以点一下。'],
  en: ['(E2E) Claude streams ', 'this answer ', 'in three parts.'],
};

export const FAKE_STREAM_MODEL = 'e2e-fake-model';

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

  constructor(private readonly chunks: readonly string[], private readonly delayMs: number) {}

  on(event: string, listener: StreamListener): this {
    if (event === 'streamEvent') this.listeners.push(listener);
    return this;
  }

  async finalMessage(): Promise<Anthropic.Message> {
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

/** The stand-in client: the answer in the turn's language, `delayMs` between chunks. */
export function fakeStreamingClient(language: AskLanguage = 'zh', delayMs = 250): Pick<Anthropic, 'messages'> {
  const chunks = FAKE_STREAM_CHUNKS[language];
  return {
    messages: {
      create: async () => message(chunks.join(''), 'end_turn'),
      stream: () => new FakeMessageStream(chunks, delayMs),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
