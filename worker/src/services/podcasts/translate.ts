/**
 * The English of a podcast's segments (docs/PODCASTS.md), a batch at a time: Claude through
 * `structuredCall` (forced tool, thinking off, the shape checked, retried, the last attempt on
 * the fallback model) — the same model and price as the story lessons' translation. The
 * Chinese is never rewritten; speech-recognition slips are translated as heard.
 */
import { structuredCall } from '../structured-call';
import { STORY_PRICE, STORY_TRANSLATE_MODEL } from '../audio-lessons/story';

export interface SegmentBatchRequest {
  /** The segments to translate, by their index in the episode. */
  segments: Array<{ i: number; text: string; speaker: string | null }>;
  /** A few segments just before, for context (not translated). */
  before: string[];
  podcastTitle: string | null;
  episodeTitle: string;
}

export interface SegmentBatchResult {
  items: Array<{ i: number; english: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export type SegmentTranslate = (req: SegmentBatchRequest) => Promise<SegmentBatchResult>;

/** Segments per call (≈ 2–4 minutes of speech). */
export const TRANSLATE_BATCH = 40;

export const SEGMENT_SYSTEM = `You translate the transcript of a Chinese podcast, segment by segment, for an English-speaking learner who listens to one segment at a time and then checks your English.

The transcript comes from speech recognition: it can have small slips, missing punctuation, filler words (嗯, 那个, 就是) and English words mixed in. For every segment give "english": a natural, faithful English translation of exactly that segment as it was said — one or two plain sentences. Don't add, explain, summarise or correct; a segment that is only a filler or a half sentence gets a short literal translation ("Um, so…"). Keep names as names. No Chinese characters and no pinyin in the English.
Translate every segment you are given, by its number. The segments before are context only.`;

export function segmentBatchUser(req: SegmentBatchRequest): string {
  const parts: string[] = [`Podcast: ${req.podcastTitle ?? 'unknown'} — episode: ${req.episodeTitle}`];
  if (req.before.length) parts.push(`Context — the segments just before (do not translate):\n${req.before.join('\n')}`);
  parts.push(
    `Translate these ${req.segments.length} segments:\n${req.segments.map((s) => `[${s.i}] ${s.speaker ? `(speaker ${s.speaker}) ` : ''}${s.text}`).join('\n')}`,
  );
  return parts.join('\n\n');
}

const TOOL = {
  name: 'submit_translations',
  description: 'The English translation of every segment, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      segments: {
        type: 'array',
        items: { type: 'object', properties: { i: { type: 'integer' }, english: { type: 'string' } }, required: ['i', 'english'] },
      },
    },
    required: ['segments'],
  },
};

/** The tool's answer → every asked segment's English, or a throw (structuredCall retries it). */
export function checkSegmentBatch(req: SegmentBatchRequest, raw: unknown): Omit<SegmentBatchResult, 'usage'> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { segments?: unknown };
  const got = new Map<number, string>();
  for (const c of Array.isArray(input.segments) ? input.segments : []) {
    const r = c as { i?: unknown; english?: unknown };
    if (typeof r.i !== 'number' || typeof r.english !== 'string') continue;
    const english = r.english.replace(/\s+/g, ' ').trim();
    if (!english || /[㐀-鿿]/.test(english)) continue;
    got.set(r.i, english.slice(0, 600));
  }
  const missing = req.segments.filter((s) => !got.has(s.i)).map((s) => s.i);
  if (missing.length) throw new Error(`No usable translation for segments ${missing.slice(0, 10).join(', ')}`);
  return { items: req.segments.map((s) => ({ i: s.i, english: got.get(s.i)! })) };
}

export function anthropicSegmentTranslate(apiKey: string): SegmentTranslate {
  return async (req) => {
    let usage = { input_tokens: 0, output_tokens: 0 };
    const out = await structuredCall({
      apiKey,
      model: STORY_TRANSLATE_MODEL,
      system: SEGMENT_SYSTEM,
      user: segmentBatchUser(req),
      tool: TOOL,
      maxTokens: Math.min(16_000, 600 + req.segments.length * 120),
      validate: (raw) => checkSegmentBatch(req, raw),
      timeoutMs: 120_000,
      onUsage: (u) => {
        usage = { input_tokens: usage.input_tokens + u.input_tokens, output_tokens: usage.output_tokens + u.output_tokens };
      },
    });
    return { ...out, usage };
  };
}

/** E2E_TEST_MODE: a translation without Claude. */
export function fakeSegmentTranslate(): SegmentTranslate {
  return async (req) => ({
    items: req.segments.map((s) => ({ i: s.i, english: `Segment ${s.i + 1} of the episode.` })),
    usage: { input_tokens: 300, output_tokens: 200 },
  });
}

/** Estimated $ of the translation tokens. */
export function translateCostUsd(u: { input_tokens: number; output_tokens: number }): number {
  return (u.input_tokens * STORY_PRICE.input + u.output_tokens * STORY_PRICE.output) / 1_000_000;
}
