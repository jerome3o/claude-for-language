/**
 * Gemini models and the one way the worker calls them.
 *
 * Google retires and renames Gemini models often, and restricts old ones: since
 * September 2026 the 2.5 family is only served to keys that already used it, so
 * a key that never called `gemini-2.5-flash` gets a plain 404 for it (that broke
 * picture-hunt detection), and `gemini-2.5-flash-image` shuts down on
 * 2026-10-02. Every Gemini call therefore names a LIST of models, best first:
 * a 404 (or a 400 / 403 that is about the model or its thinking settings) moves
 * on to the next one, and the model that answered is remembered for the rest of
 * the isolate's life so later calls skip the dead ones. A future rename is a
 * one-line change here.
 *
 * Errors carry Google's own message (never the key: it travels in the
 * `x-goog-api-key` header, not the URL).
 */

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Text + vision (+ audio input) models: object detection / segmentation,
 * transcription. Current stable Flash models first (ai.google.dev/gemini-api/docs/models),
 * the access-limited 2.5 Flash last.
 */
export const GEMINI_FLASH_MODELS: readonly string[] = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
];

/** Image generation ("Nano Banana"): reader / lesson illustrations, picture-hunt scenes. */
export const GEMINI_IMAGE_MODELS: readonly string[] = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
];

/** Gemini 3.x models that accept thinkingLevel "minimal" (the rest go no lower than "low"). */
const MINIMAL_THINKING = new Set(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview']);

/**
 * The least thinking a model allows, as a `generationConfig.thinkingConfig`.
 * Detection, segmentation and transcription want none (Google's guidance), and
 * thinking only adds latency. 2.5 takes a budget, 3.x a level; unknown → omit.
 */
export function leastThinking(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 0 };
  if (MINIMAL_THINKING.has(model)) return { thinkingLevel: 'minimal' };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    /** Google's message (already trimmed and key-free). */
    readonly googleMessage: string,
    readonly model: string,
    readonly tried: string[],
  ) {
    super(`Gemini ${status}${googleMessage ? `: ${googleMessage}` : ''}`);
    this.name = 'GeminiError';
  }
}

/** Google's error message from a failed response body, trimmed, with anything key-like removed. */
export function geminiErrorMessage(bodyText: string, max = 240): string {
  let message = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; status?: string } } | Array<{ error?: { message?: string } }>;
    const err = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    if (err?.message) message = err.message;
  } catch {
    /* not JSON: use the text */
  }
  message = message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]')
    .replace(/([?&]key=)[^&\s"]+/g, '$1[key]')
    .replace(/\s+/g, ' ')
    .trim();
  return message.length > max ? `${message.slice(0, max - 1)}…` : message;
}

/** Should this failure move on to the next model in the list? */
function isModelProblem(status: number, message: string): boolean {
  if (status === 404) return true;
  if (status === 400 || status === 403) return /model|thinking/i.test(message);
  return false;
}

/** Which model in each list answered last (per isolate). */
const workingModel = new Map<string, string>();

/** Test seam: forget remembered models. */
export function resetGeminiModelMemory(): void {
  workingModel.clear();
}

/** The order to try: an explicit override first, then the remembered working model, then the list. */
export function modelOrder(models: readonly string[], override?: string | null): string[] {
  const remembered = workingModel.get(models.join(','));
  const head = [override?.trim(), remembered].filter((m): m is string => !!m);
  return [...new Set([...head, ...models])];
}

export interface GeminiCall {
  apiKey: string;
  /** Candidate models, best first (one of the lists above). */
  models: readonly string[];
  /** A model to try before the list (e.g. an env override). */
  override?: string | null;
  /** The request body for a given model (thinking settings differ per model). */
  body: (model: string) => unknown;
  fetch?: FetchLike;
  /** Log prefix, e.g. "picture-hunt detect". */
  label?: string;
}

/**
 * POST `:generateContent` to the first model in the list that exists for this
 * key. Returns the parsed JSON and the model that answered; throws GeminiError
 * with Google's message for the last failure.
 */
export async function geminiGenerateContent<T>(call: GeminiCall): Promise<{ data: T; model: string }> {
  const fetchImpl = call.fetch ?? fetch;
  const order = modelOrder(call.models, call.override);
  const listKey = call.models.join(',');
  const tried: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    tried.push(model);
    const response = await fetchImpl(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
      body: JSON.stringify(call.body(model)),
    });
    if (response.ok) {
      if (workingModel.get(listKey) !== model && call.models.includes(model)) workingModel.set(listKey, model);
      return { data: (await response.json()) as T, model };
    }
    const message = geminiErrorMessage(await response.text().catch(() => ''));
    const last = i === order.length - 1;
    console.warn(`[gemini] ${call.label ?? 'call'}: ${model} answered ${response.status}${message ? ` — ${message}` : ''}${!last && isModelProblem(response.status, message) ? '; trying the next model' : ''}`);
    if (workingModel.get(listKey) === model) workingModel.delete(listKey);
    if (last || !isModelProblem(response.status, message)) throw new GeminiError(response.status, message, model, tried);
  }
  throw new GeminiError(0, 'no Gemini model configured', '', tried);
}

