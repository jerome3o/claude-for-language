/**
 * Every model call's usage, without touching the ~35 call sites: a wrapper
 * around `fetch` (installed once from index.ts) notices responses from the
 * Anthropic and Gemini APIs, reads the `usage` block from a clone of the JSON
 * body in the background and records `server.ai_call` with the model, tokens
 * and an estimated cost (plus one structured log line for Workers Observability).
 * Streams and non-JSON bodies are passed through untouched. Never changes
 * what the caller receives.
 */
import type { Env } from '../../types';
import { currentScope, keepAlive } from './scope';
import { trackServer } from './server-events';

/**
 * USD per million tokens: [input, output]. Cache reads are ~0.1× input. Estimates
 * from the providers' list prices (paid tier). The first matching prefix wins, so
 * the specific names come before the family ones.
 */
export const MODEL_PRICES: ReadonlyArray<[prefix: string, input: number, output: number]> = [
  ['claude-opus-5-5', 4, 20],
  ['claude-opus', 5, 25],
  ['claude-sonnet-5', 2, 10],
  ['claude-sonnet-4-6', 3, 15],
  ['claude-sonnet-4', 3, 15],
  ['claude-haiku-4', 1, 5],
  ['claude-fable', 10, 50],
  // Image models: these are the TEXT output prices (incl. thinking); their IMAGE
  // output tokens are priced from GEMINI_IMAGE_OUTPUT_PRICES below.
  ['gemini-3-pro-image', 2, 12],
  ['gemini-3.1-flash-image', 0.5, 3],
  ['gemini-2.5-flash-image', 0.3, 2.5],
  ['gemini-3.6-flash', 0.75, 3.75],
  ['gemini-2.5-flash-lite', 0.1, 0.4],
  ['gemini-3.5-flash-lite', 0.1, 0.4],
  ['gemini', 0.3, 2.5],
];

/**
 * USD per million IMAGE output tokens of Gemini's image models (Oct 2026 list prices).
 * One 1024×1024 picture is ~1,290 tokens on 2.5 Flash Image ($0.039) and ~1,120 on
 * 3.1 Flash Image ($0.067). Before this, picture tokens were priced at the text rate
 * ($2.50 / M) — the AI dashboard under-reported every illustration by ~10–20×.
 */
export const GEMINI_IMAGE_OUTPUT_PRICES: ReadonlyArray<[prefix: string, perMillion: number]> = [
  ['gemini-3-pro-image', 120],
  ['gemini-3.1-flash-image', 60],
  ['gemini-2.5-flash-image', 30],
];

export function imageOutputPriceFor(model: string): number | null {
  const m = model.toLowerCase();
  return GEMINI_IMAGE_OUTPUT_PRICES.find(([prefix]) => m.startsWith(prefix))?.[1] ?? null;
}

export interface AiUsage {
  provider: 'anthropic' | 'gemini';
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  status: number;
}

export function priceFor(model: string): [number, number] | null {
  const m = model.toLowerCase();
  const hit = MODEL_PRICES.find(([prefix]) => m.startsWith(prefix));
  return hit ? [hit[1], hit[2]] : null;
}

/**
 * Estimated USD. `imageOutput` = how many of the `output` tokens are image tokens
 * (Gemini's image models), priced at the image rate; the rest at the text rate.
 */
export function estimateCost(model: string, input: number, output: number, cacheRead = 0, imageOutput = 0): number {
  const p = priceFor(model);
  if (!p) return 0;
  const imagePrice = imageOutputPriceFor(model);
  const image = imagePrice === null ? 0 : Math.max(0, Math.min(output, imageOutput));
  const text = output - image;
  const usd = (input * p[0] + cacheRead * p[0] * 0.1 + text * p[1] + image * (imagePrice ?? 0)) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Image tokens of a Gemini answer: `candidatesTokensDetails[].modality === 'IMAGE'`.
 * An image model that answers without the breakdown: every candidate token is
 * counted as image (an image model's output is almost all picture).
 */
export function geminiImageOutputTokens(model: string, usageMetadata: Record<string, any>): number {
  if (imageOutputPriceFor(model) === null) return 0;
  const details = usageMetadata.candidatesTokensDetails;
  if (Array.isArray(details) && details.length) {
    return details.reduce((n: number, d: any) => n + (String(d?.modality ?? '').toUpperCase() === 'IMAGE' ? Number(d?.tokenCount) || 0 : 0), 0);
  }
  return Number(usageMetadata.candidatesTokenCount) || 0;
}

export function providerOf(url: string): 'anthropic' | 'gemini' | null {
  if (url.startsWith('https://api.anthropic.com/')) return 'anthropic';
  if (url.startsWith('https://generativelanguage.googleapis.com/')) return 'gemini';
  return null;
}

/** Reads usage out of a provider's JSON response. Pure. */
export function parseAiUsage(provider: 'anthropic' | 'gemini', url: string, body: unknown, status: number): AiUsage | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, any>;
  if (provider === 'anthropic') {
    const u = b.usage;
    if (!u || typeof u !== 'object') return null;
    const model = typeof b.model === 'string' ? b.model : 'unknown';
    const input = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
    const output = Number(u.output_tokens) || 0;
    const cacheRead = Number(u.cache_read_input_tokens) || 0;
    return { provider, model, input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cost_usd: estimateCost(model, input, output, cacheRead), status };
  }
  const u = b.usageMetadata;
  if (!u || typeof u !== 'object') return null;
  const fromUrl = /\/models\/([^/:?]+)/.exec(url)?.[1];
  const model = typeof b.modelVersion === 'string' ? b.modelVersion : fromUrl ?? 'gemini';
  const input = Number(u.promptTokenCount) || 0;
  const output = (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
  const cacheRead = Number(u.cachedContentTokenCount) || 0;
  const image = geminiImageOutputTokens(model, u);
  return { provider, model, input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cost_usd: estimateCost(model, input, output, cacheRead, image), status };
}

export function recordAiUsage(usage: AiUsage, env?: Env): Promise<void> {
  const scope = currentScope();
  console.log(JSON.stringify({ type: 'ai_call', ...usage, route: scope?.route ?? null, user_id: scope?.userId ?? null }));
  return trackServer('server.ai_call', { ...usage }, env ? { env } : {});
}

let installed = false;

/** Wraps globalThis.fetch once per isolate. */
export function installAiUsageCapture(): void {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const original = globalThis.fetch;
  const wrapped = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const res = await original.call(globalThis, input as RequestInfo, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const provider = providerOf(url);
      if (provider && currentScope()) {
        const type = res.headers.get('content-type') || '';
        if (type.includes('application/json')) {
          const clone = res.clone();
          keepAlive(
            clone.json().then((body) => {
              const usage = parseAiUsage(provider, url, body, res.status);
              return usage ? recordAiUsage(usage) : undefined;
            })
          );
        }
      }
    } catch {
      // never let analytics touch the caller's response
    }
    return res;
  };
  globalThis.fetch = wrapped as typeof fetch;
}
