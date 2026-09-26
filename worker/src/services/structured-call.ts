import Anthropic from '@anthropic-ai/sdk';

/**
 * One reliable "give me this JSON" call to Claude — for short, user-facing
 * replies that must not fail (the Sentence Coach's first answer).
 *
 * Why each piece is here:
 * - A forced tool with an input schema instead of "respond with JSON" text:
 *   no fishing JSON out of prose, no broken quotes.
 * - thinking DISABLED explicitly: Sonnet 5 thinks by default, thinking tokens
 *   share max_tokens, and forced tool use rules thinking out anyway. A small
 *   max_tokens with default thinking is how the coach's first reply broke.
 * - stop_reason checked: 'max_tokens' means the tool input is cut off, so the
 *   next attempt gets double the budget; 'refusal' is reported as such.
 * - validate() runs on the parsed input; a bad shape is retried like any error.
 * - Every failure except a request we built wrongly (400/401/403/404) is
 *   retried; the last attempt goes to a fallback model (Haiku), so an overloaded
 *   or failing primary model still yields an answer.
 * - A per-request timeout so a hung connection can't hold the user forever.
 */

export class StructuredCallError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface StructuredCallOptions<T> {
  apiKey: string;
  model: string;
  /** Used for the final attempt; defaults to Haiku 4.5. Pass null to disable. */
  fallbackModel?: string | null;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: Anthropic.Tool.InputSchema };
  maxTokens: number;
  /** Throw to reject the shape (it is retried); return the cleaned value. */
  validate: (input: unknown) => T;
  attempts?: number;
  timeoutMs?: number;
  /** Test seam: supply a client instead of constructing one. */
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_FALLBACK_MODEL = 'claude-haiku-4-5';

function isFatalApiError(error: unknown): boolean {
  return error instanceof Anthropic.APIError && [400, 401, 403, 404].includes(error.status ?? 0);
}

export async function structuredCall<T>(opts: StructuredCallOptions<T>): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const fallback = opts.fallbackModel === undefined ? DEFAULT_FALLBACK_MODEL : opts.fallbackModel;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 45_000, maxRetries: 1 });
  let maxTokens = opts.maxTokens;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    const isLast = attempt === attempts - 1;
    const model = isLast && attempts > 1 && fallback ? fallback : opts.model;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        system: opts.system,
        tools: [opts.tool],
        tool_choice: { type: 'tool', name: opts.tool.name },
        messages: [{ role: 'user', content: opts.user }],
      });
      if (response.stop_reason === 'max_tokens') {
        maxTokens = Math.min(maxTokens * 2, 16_000);
        throw new Error(`Reply was cut off at ${response.usage?.output_tokens ?? '?'} tokens`);
      }
      if (response.stop_reason === 'refusal') {
        throw new StructuredCallError('Claude declined to answer this one', false);
      }
      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude returned no structured answer');
      return opts.validate(toolUse.input);
    } catch (error) {
      lastError = error;
      if (error instanceof StructuredCallError && !error.retryable) throw error;
      // A request we built wrongly will fail the same way on the primary model;
      // still try the fallback once in case it is a model-specific rejection.
      if (isFatalApiError(error) && (isLast || !fallback)) break;
      console.warn(`[structuredCall] ${opts.tool.name} attempt ${attempt + 1}/${attempts} on ${model} failed:`, error instanceof Error ? error.message : error);
      if (isFatalApiError(error) && fallback && attempt < attempts - 1) {
        attempt = attempts - 2; // jump straight to the fallback attempt
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new StructuredCallError(message, !isFatalApiError(lastError));
}
