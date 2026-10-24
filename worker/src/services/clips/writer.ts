/**
 * 🎬 The clip writer (docs/CLIPS.md "Generation"): Claude writes ONE clip spec with a forced
 * tool, thinking off (the lesson writers' path: services/companion-lesson.ts), from a brief of
 * the topic, the focus words and what the learner is studying / struggling with; the spec goes
 * through the 一 / 不 tone changes and `validateClipSpec`, and back for up to two repair rounds
 * with the problems. E2E_TEST_MODE / no key: `fakeClipSpec` (deterministic, no call).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  CLIP_LAYOUTS,
  CLIP_SPEC_DOC,
  CLIP_THEMES,
  CLIP_VOICES,
  SAMPLE_CLIP,
  validateClipSpec,
  type ClipSpec,
  type ClipTheme,
  type ClipWord,
} from '@shared/clips';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { LESSON_WRITER_MODEL, applyYiBuToSpec, withRetry, type CreateMessage } from '../companion-lesson';
import type { LearnerContext } from './store';

export const CLIP_TOOL = 'submit_clip';
const MAX_REPAIR_ROUNDS = 2;
const MAX_TOKENS = 8000;

export interface ClipBrief {
  topic: string | null;
  /** Focus words asked for (hanzi; the learner's own notes fill in pinyin / english when known). */
  words: string[];
  /** 1-based place among the clips asked for together, and how many. */
  variant: number;
  of: number;
}

export const CLIP_WRITER_SYSTEM = `You write ONE short vertical learning clip ("TikTok for Chinese") for a Chinese learner (adult, ≈ HSK 3, studies every day on his phone, likes humour and real-life situations). The app plays your JSON script like a video. Return it with the ${CLIP_TOOL} tool.

${CLIP_SPEC_DOC}

How to write a good one
- ONE idea (a confusable pair, a word's hidden meaning, a pattern, a cultural moment) built around words he is actually learning (the brief lists them). The focus "words" are words he will want to drill afterwards.
- Hook in the first scene (a surprise, a mistake he probably makes, a question); a twist or payoff in the middle; a quiz he can answer from what the clip just taught; an ending question he can answer in his head.
- Mix layouts: a title, then 4–8 of big_word / sentence / compare / story / quiz / list / fact. Exactly one or two quizzes.
- Voice lines: short. Use "zh" for Chinese he should hear, "en" for the narration. Scenes with Chinese on screen often need NO voice (a sentence, big word, list or story reads its own Chinese).
- Pick the theme that fits the mood: neon (bold, punchy), paper (calm notebook), chalk (classroom), comic (funny), sunset (warm story), mono (minimal, serious), ink (traditional, idioms, history), retro (pixel, games, nostalgia).
- At most one or two image_prompts, only for a story or a scene that needs a picture; describe a vertical illustration with no text and no real people.
- Pinyin: tone marks, spaces between words, the 一 / 不 tone changes written: ${YI_BU_CONVENTION}
- Simplified characters, mainland usage. Never invent facts; say "people say…" for folk stories.`;

/** The JSON schema of the tool (the spec's shape; the doc in the system prompt has the details). */
export const CLIP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    v: { type: 'integer', enum: [1] },
    title: { type: 'string' },
    hook: { type: 'string' },
    topic: { type: 'string' },
    style: { type: 'object', properties: { theme: { type: 'string', enum: [...CLIP_THEMES] }, accent: { type: 'string' } }, required: ['theme'] },
    words: { type: 'array', items: { type: 'object', properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } }, required: ['hanzi', 'pinyin', 'english'] } },
    tags: { type: 'array', items: { type: 'string' } },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          layout: { type: 'string', enum: [...CLIP_LAYOUTS] },
          duration_ms: { type: 'integer' },
          voice: { type: 'object', properties: { text: { type: 'string' }, lang: { type: 'string', enum: ['zh', 'en'] }, voice: { type: 'string', enum: [...CLIP_VOICES] } }, required: ['text', 'lang'] },
          image_prompt: { type: 'string' },
          emoji: { type: 'string' },
          title: { type: 'object' },
          big_word: { type: 'object' },
          sentence: { type: 'object' },
          compare: { type: 'object' },
          quiz: { type: 'object' },
          story: { type: 'object' },
          list: { type: 'object' },
          fact: { type: 'object' },
        },
        required: ['layout', 'duration_ms'],
      },
    },
    ending: { type: 'object', properties: { question_en: { type: 'string' }, cta: { type: 'string' } } },
  },
  required: ['v', 'title', 'hook', 'style', 'words', 'scenes'],
} as const;

const line = (w: { hanzi: string; pinyin: string; english: string }) => `${w.hanzi} | ${w.pinyin} | ${w.english}`;

/** The user message: what to make, the learner's words, what to avoid repeating. */
export function clipBriefText(brief: ClipBrief, ctx: LearnerContext, existingTitles: string[]): string {
  const known = new Map([...ctx.studying, ...ctx.struggling].map((w) => [w.hanzi, w]));
  const parts: string[] = [];
  parts.push(brief.topic ? `Topic: ${brief.topic}` : 'Topic: your choice — something useful around the words he is studying now.');
  if (brief.words.length) {
    parts.push(`Focus words (make these the clip's "words"):\n${brief.words.map((h) => (known.get(h) ? line(known.get(h)!) : h)).join('\n')}`);
  }
  if (brief.of > 1) parts.push(`This is clip ${brief.variant} of ${brief.of} on this topic: take a DIFFERENT angle from the others (a different idea, situation and theme).`);
  if (ctx.struggling.length) parts.push(`Words he keeps getting wrong lately:\n${ctx.struggling.slice(0, 15).map(line).join('\n')}`);
  if (ctx.studying.length) parts.push(`Words he studied in the last two weeks (use some, keep the rest of the language simple):\n${ctx.studying.slice(0, 50).map(line).join('\n')}`);
  if (ctx.decks.length) parts.push(`His newest decks: ${ctx.decks.join(', ')}`);
  if (existingTitles.length) parts.push(`Clips he already has (don't repeat them):\n${existingTitles.slice(0, 30).map((t) => `- ${t}`).join('\n')}`);
  return parts.join('\n\n');
}

/** Write one spec: forced tool, thinking off, the 一 / 不 rule, validated, ≤ 2 repair rounds. */
export async function writeClipSpec(
  brief: ClipBrief,
  ctx: LearnerContext,
  existingTitles: string[],
  create: CreateMessage,
  onUsage?: (u: { input: number; output: number }) => void,
): Promise<ClipSpec> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: clipBriefText(brief, ctx, existingTitles) }];
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await withRetry(create, {
      model: LESSON_WRITER_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: CLIP_WRITER_SYSTEM,
      tools: [{ name: CLIP_TOOL, description: 'Return the complete clip spec (v1).', input_schema: CLIP_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: CLIP_TOOL },
      messages,
    });
    onUsage?.({ input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 });
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error(response.stop_reason === 'max_tokens' ? 'The clip came back cut off' : 'No clip in the reply');
    const raw = toolUse.input as ClipSpec;
    if (raw && typeof raw === 'object') {
      raw.v = 1;
      if (brief.topic && !raw.topic) raw.topic = brief.topic;
      applyYiBuToSpec(raw);
    }
    const errors = validateClipSpec(raw);
    if (errors.length === 0) return raw;
    lastErrors = errors;
    if (round === MAX_REPAIR_ROUNDS) break;
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Not valid yet. Fix every problem below and call ${CLIP_TOOL} again with the COMPLETE corrected clip:\n${errors.map((e) => `- ${e}`).join('\n')}` }],
      },
    );
  }
  throw new Error(`Could not write a valid clip: ${lastErrors.slice(0, 4).join('; ')}`);
}

/** E2E / no key: a deterministic clip (the sample, re-titled for the topic, a theme per variant). */
export function fakeClipSpec(brief: ClipBrief, words: ClipWord[] = []): ClipSpec {
  const spec = JSON.parse(JSON.stringify(SAMPLE_CLIP)) as ClipSpec;
  const topic = (brief.topic ?? '').trim() || 'Words you are learning';
  const theme: ClipTheme = CLIP_THEMES[(brief.variant - 1) % CLIP_THEMES.length];
  spec.title = `${topic} · clip ${brief.variant}`.slice(0, 60);
  spec.hook = `A quick one on ${topic}`.slice(0, 60);
  spec.topic = topic;
  spec.style = { theme };
  if (words.length) spec.words = words.slice(0, 6);
  return spec;
}
