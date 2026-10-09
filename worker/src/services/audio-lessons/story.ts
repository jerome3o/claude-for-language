/**
 * Story lessons — "Listen & repeat a story" (docs/AUDIO_LESSONS.md "Story"): the "writing" phase
 * of the audio-lesson job for format story. No authoring agent: the pasted text is split by code
 * (`splitStoryText`, shared), cut to what one lesson holds (`fitStoryChunks`), and Claude only
 * TRANSLATES each chunk — natural English + pinyin, the Chinese kept exactly as given — in
 * batches through `structuredCall` (forced tool, thinking off). The translations are checkpointed
 * in the row after every batch, so a redelivery resumes where it stopped.
 */
import {
  compileStoryLesson,
  fitStoryChunks,
  splitStoryText,
  storyFallbackTitle,
  storySpeakers,
  STORY_LIMITS,
  validateScript,
  validateStoryPlan,
  type AudioLessonInput,
  type AudioLessonScript,
  type Gender,
  type StoryChunk,
  type StoryPlan,
} from '@shared/audio-lesson';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { pinyin as pinyinPro } from 'pinyin-pro';
import { structuredCall } from '../structured-call';
import type { AuthorUsage } from './agent';

/** Translation is a plain, faithful job: Sonnet, thinking off (structuredCall falls back to Haiku). */
export const STORY_TRANSLATE_MODEL = 'claude-sonnet-5';
/** $ per million tokens (input, output) — services/analytics/ai-usage.ts. */
export const STORY_PRICE = { input: 2, output: 10 };

export interface StoryBatchRequest {
  /** The chunks to translate, with their index in the lesson. */
  chunks: Array<{ i: number; hanzi: string; speaker: string | null }>;
  /** The few chunks just before, for context (not translated). */
  before: string[];
  /** Every speaker label of the text. */
  labels: string[];
}

export interface StoryBatchResult {
  items: Array<{ i: number; english: string; pinyin: string }>;
  /** The voice gender per speaker label (Claude's guess from the names and the text). */
  speakers: Array<{ label: string; gender: Gender }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export type StoryTranslate = (req: StoryBatchRequest) => Promise<StoryBatchResult>;

export const STORY_SYSTEM = `You translate a Chinese story or conversation, chunk by chunk, for an English-speaking learner who will HEAR each chunk three times in Chinese and then your English once.

For every chunk:
- english: a natural, faithful English translation of exactly that chunk — what it says, in plain spoken English, one or two sentences. Do not add, explain or summarise; do not correct the Chinese. Keep names as names (pinyin without tone marks is fine for a name: Minghui). No Chinese characters, no pinyin with tone marks.
- pinyin: the chunk in pinyin with tone marks, words separated by spaces, keeping its punctuation; 一 and 不 with their tone changes (yí gè, bú shì); no other tone sandhi.
Translate every chunk you are given, by its number. The chunks before are context only.
speakers: for each speaker label given, the voice to read it in — "female" or "male", guessed from the name and what they say (a plain letter like A or B: alternate, A female).`;

function quote(c: { hanzi: string; speaker: string | null }): string {
  return c.speaker ? `${c.speaker}：${c.hanzi}` : c.hanzi;
}

export function storyBatchUser(req: StoryBatchRequest): string {
  const parts: string[] = [];
  if (req.labels.length) parts.push(`Speaker labels: ${req.labels.join('、')}`);
  if (req.before.length) parts.push(`Context — the chunks just before (do not translate):\n${req.before.join('\n')}`);
  parts.push(`Translate these ${req.chunks.length} chunks:\n${req.chunks.map((c) => `[${c.i}] ${quote(c)}`).join('\n')}`);
  return parts.join('\n\n');
}

const TOOL = {
  name: 'submit_translations',
  description: 'The English translation and the pinyin of every chunk, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { i: { type: 'integer' }, english: { type: 'string' }, pinyin: { type: 'string' } },
          required: ['i', 'english', 'pinyin'],
        },
      },
      speakers: {
        type: 'array',
        items: { type: 'object', properties: { label: { type: 'string' }, gender: { type: 'string', enum: ['female', 'male'] } }, required: ['label', 'gender'] },
      },
    },
    required: ['chunks', 'speakers'],
  },
};

/** The tool's answer → the result, or a throw (structuredCall retries it). Every asked chunk must be there. */
export function checkStoryBatch(req: StoryBatchRequest, raw: unknown): Omit<StoryBatchResult, 'usage'> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { chunks?: unknown; speakers?: unknown };
  const got = new Map<number, { english: string; pinyin: string }>();
  for (const c of Array.isArray(input.chunks) ? input.chunks : []) {
    const r = c as { i?: unknown; english?: unknown; pinyin?: unknown };
    if (typeof r.i !== 'number' || typeof r.english !== 'string' || typeof r.pinyin !== 'string') continue;
    const english = r.english.trim();
    if (!/[A-Za-z]/.test(english) || /[㐀-鿿]/.test(english)) continue;
    got.set(r.i, { english, pinyin: r.pinyin.trim() });
  }
  const missing = req.chunks.filter((c) => !got.has(c.i)).map((c) => c.i);
  if (missing.length) throw new Error(`No usable translation for chunks ${missing.slice(0, 10).join(', ')}`);
  const speakers = (Array.isArray(input.speakers) ? input.speakers : []).flatMap((s) => {
    const r = s as { label?: unknown; gender?: unknown };
    return typeof r.label === 'string' && (r.gender === 'female' || r.gender === 'male') ? [{ label: r.label.trim(), gender: r.gender as Gender }] : [];
  });
  return { items: req.chunks.map((c) => ({ i: c.i, ...got.get(c.i)! })), speakers };
}

export function anthropicStoryTranslate(apiKey: string): StoryTranslate {
  return async (req) => {
    let usage = { input_tokens: 0, output_tokens: 0 };
    const out = await structuredCall({
      apiKey,
      model: STORY_TRANSLATE_MODEL,
      system: STORY_SYSTEM,
      user: storyBatchUser(req),
      tool: TOOL,
      maxTokens: Math.min(16_000, 600 + req.chunks.length * 160),
      validate: (raw) => checkStoryBatch(req, raw),
      timeoutMs: 120_000,
      onUsage: (u) => {
        usage = { input_tokens: usage.input_tokens + u.input_tokens, output_tokens: usage.output_tokens + u.output_tokens };
      },
    });
    return { ...out, usage };
  };
}

/** E2E_TEST_MODE: a translation without Claude — "Line 3 of the story." + pinyin-pro's pinyin. */
export function fakeStoryTranslate(): StoryTranslate {
  return async (req) => ({
    items: req.chunks.map((c) => ({ i: c.i, english: `Line ${c.i + 1} of the story.`, pinyin: pinyinPro(c.hanzi, { toneType: 'symbol' }) })),
    speakers: req.labels.map((label, i) => ({ label, gender: i % 2 === 0 ? 'female' : 'male' })),
    usage: { input_tokens: 400, output_tokens: 300 },
  });
}

/** What the job keeps in `agent_transcript` while translating (resumable). */
export interface StoryState {
  title: string;
  chunks: StoryChunk[];
  cut?: StoryPlan['cut'];
  translations: Array<{ english: string; pinyin: string } | null>;
  speakers: Array<{ label: string; gender: Gender }>;
}

/** The pasted text → the chunks one lesson holds (null when there is nothing to say). */
export function startStory(input: AudioLessonInput): StoryState | null {
  const all = splitStoryText(input.text ?? '');
  if (all.length === 0) return null;
  const { chunks, cut } = fitStoryChunks(all);
  const state: StoryState = { title: (input.title || storyFallbackTitle(chunks)).slice(0, 120), chunks, translations: chunks.map(() => null), speakers: [] };
  if (cut) state.cut = cut;
  return state;
}

export type StoryOutcome =
  | { kind: 'done'; plan: StoryPlan; script: AudioLessonScript }
  | { kind: 'continue' }
  | { kind: 'failed'; reason: string };

/**
 * Translate what is still missing, batch by batch (checkpointing each), then build the plan and
 * the script. `usage` is added to in place.
 */
export async function writeStory(args: {
  state: StoryState;
  translate: StoryTranslate;
  usage: AuthorUsage;
  deadline: number;
  now?: () => number;
  checkpoint: (state: StoryState, progress: string) => Promise<void>;
}): Promise<StoryOutcome> {
  const { state, translate, usage, checkpoint } = args;
  const now = args.now ?? Date.now;
  const labels = storySpeakers(state.chunks);
  const total = state.chunks.length;
  for (;;) {
    const todo = state.chunks.map((_, i) => i).filter((i) => !state.translations[i]).slice(0, STORY_LIMITS.translateBatch);
    if (todo.length === 0) break;
    if (now() > args.deadline) return { kind: 'continue' };
    const first = todo[0];
    const req: StoryBatchRequest = {
      chunks: todo.map((i) => ({ i, hanzi: state.chunks[i].hanzi, speaker: state.chunks[i].speaker })),
      before: state.chunks.slice(Math.max(0, first - 3), first).map(quote),
      labels,
    };
    const res = await translate(req);
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;
    const byIndex = new Map(res.items.map((t) => [t.i, t]));
    for (const i of todo) {
      const t = byIndex.get(i);
      if (!t) return { kind: 'failed', reason: `Claude left line ${i + 1} untranslated` };
      // Every automatic pinyin goes through the one 一 / 不 rule (CLAUDE.md "Card standard").
      state.translations[i] = { english: t.english, pinyin: applyYiBuToneChanges(state.chunks[i].hanzi, t.pinyin) };
    }
    for (const s of res.speakers) if (labels.includes(s.label) && !state.speakers.some((x) => x.label === s.label)) state.speakers.push(s);
    const done = state.translations.filter(Boolean).length;
    await checkpoint(state, `Translating — ${done} of ${total} lines…`);
  }
  // Labels Claude gave no voice for: alternate, A female.
  labels.forEach((label, i) => {
    if (!state.speakers.some((s) => s.label === label)) state.speakers.push({ label, gender: i % 2 === 0 ? 'female' : 'male' });
  });
  const plan: StoryPlan = {
    title: state.title,
    speakers: labels.map((label) => state.speakers.find((s) => s.label === label)!),
    chunks: state.chunks.map((c, i) => ({ hanzi: c.hanzi, pinyin: state.translations[i]!.pinyin, english: state.translations[i]!.english, speaker: c.speaker, section: c.section })),
  };
  if (state.cut) plan.cut = state.cut;
  const problems = validateStoryPlan(plan);
  if (problems.length) return { kind: 'failed', reason: problems[0] };
  const script = compileStoryLesson(plan);
  const scriptProblems = validateScript(script);
  if (scriptProblems.length) return { kind: 'failed', reason: scriptProblems[0] };
  return { kind: 'done', plan, script };
}

export function storyCostUsd(u: AuthorUsage): number {
  return Math.round(((u.input_tokens * STORY_PRICE.input + u.output_tokens * STORY_PRICE.output) / 1e6) * 10000) / 10000;
}
