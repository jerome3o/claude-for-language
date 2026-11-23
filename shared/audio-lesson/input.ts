/**
 * What a "New audio lesson" request may carry (POST /api/audio-lessons, the MCP
 * create_audio_lesson tool, both apps' forms) → a clean input or problems.
 */
import { hasHan } from './compile';
import { fitStoryChunks, splitStoryText, storyCutNotice, storyFallbackTitle } from './story';
import { AUDIO_LESSON_FORMATS, AUDIO_LESSON_INPUT_LIMITS, type AudioLessonFormat, type AudioLessonInput } from './types';
import { COMPOSED_LIMITS, type ComposedPlan } from './composed';

export interface PickedAudioLessonInput {
  format: AudioLessonFormat;
  input: AudioLessonInput;
  /** What the list shows until Claude names the lesson. */
  title: string;
  problems: string[];
  /** Story: said back to whoever asked — the text is longer than one lesson holds (storyCutNotice). */
  notice: string | null;
  /** Story: how many chunks the lesson will have. */
  chunks?: number;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function pickAudioLessonInput(body: unknown): PickedAudioLessonInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const L = AUDIO_LESSON_INPUT_LIMITS;
  const format = (AUDIO_LESSON_FORMATS as readonly string[]).includes(b.format as string) ? (b.format as AudioLessonFormat) : null;
  if (!format) problems.push('format must be "dialogue", "sleep" or "story"');
  const description = text(b.description);
  const dialogue = text(b.dialogue);
  const source = text(b.text);
  const input: AudioLessonInput = {};
  if (format === 'dialogue') {
    if (!description && !dialogue) problems.push('Describe the situation to practise (or paste a dialogue)');
    if (description.length > L.description) problems.push(`The description is too long (${L.description} characters at most)`);
    if (dialogue.length > L.dialogue) problems.push(`The dialogue is too long (${L.dialogue} characters at most)`);
    if (description) input.description = description;
    if (dialogue) input.dialogue = dialogue;
  } else if (format === 'sleep') {
    if (!source) problems.push('Paste the Chinese text to learn from');
    else if (!hasHan(source)) problems.push('The text has no Chinese in it');
    else if ([...source].filter((c) => hasHan(c)).length < 20) problems.push('The text is too short — paste at least a paragraph');
    if (source.length > L.text) problems.push(`The text is too long (${L.text.toLocaleString('en')} characters at most)`);
    if (source) input.text = source;
  } else if (format === 'story') {
    if (!source) problems.push('Paste the story or conversation to listen to');
    else if (!hasHan(source)) problems.push('The text has no Chinese in it');
    if (source.length > L.storyText) problems.push(`The text is too long (${L.storyText.toLocaleString('en')} characters at most) — split it into two lessons`);
    if (source) input.text = source;
  }
  let notice: string | null = null;
  let chunks: number | undefined;
  let storyTitle = '';
  if (format === 'story' && source && hasHan(source) && problems.length === 0) {
    const all = splitStoryText(source);
    if (all.length === 0) problems.push('No Chinese sentences found in the text');
    const fit = fitStoryChunks(all);
    chunks = fit.chunks.length;
    if (fit.cut) notice = storyCutNotice(fit.cut);
    storyTitle = storyFallbackTitle(fit.chunks);
  }
  // A story is as long as its text: no target length.
  if (format !== 'story' && b.target_minutes !== undefined && b.target_minutes !== null) {
    const m = Number(b.target_minutes);
    if (!Number.isFinite(m) || m < L.minMinutes || m > L.maxMinutes) problems.push(`target_minutes must be ${L.minMinutes}–${L.maxMinutes}`);
    else input.target_minutes = Math.round(m);
  }
  const given = text(b.title).slice(0, 120);
  if (given) input.title = given;
  const fallback = format === 'sleep' ? [...source].slice(0, 16).join('') : format === 'story' ? storyTitle : description.slice(0, 80) || 'Dialogue lesson';
  return { format: format ?? 'dialogue', input, title: given || fallback || 'Audio lesson', problems, notice, ...(chunks !== undefined ? { chunks } : {}) };
}

/** What a composed lesson request carries (POST /api/audio-lessons with format "composed", the MCP compose_audio_lesson). */
export interface PickedComposedRequest {
  /** A copy of the plan (the worker's pinyin check corrects it in place), its title set from `title` when given. */
  plan: ComposedPlan | null;
  title: string;
  dryRun: boolean;
  /** `source` as sent (checked by the worker against the caller's calls). */
  source: { call_id?: unknown; lesson_id?: unknown; label?: unknown } | null;
  problems: string[];
}

export function pickComposedRequest(body: unknown): PickedComposedRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const dryRun = b.dry_run === true;
  const rawPlan = b.plan;
  let plan: ComposedPlan | null = null;
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    problems.push('plan: the composed lesson plan { title, blocks: [...] } is required');
  } else {
    const size = JSON.stringify(rawPlan).length;
    if (size > COMPOSED_LIMITS.maxPlanBytes) problems.push(`plan: too big (${size.toLocaleString('en')} characters of JSON, at most ${COMPOSED_LIMITS.maxPlanBytes.toLocaleString('en')})`);
    else {
      plan = JSON.parse(JSON.stringify(rawPlan)) as ComposedPlan;
      const given = text(b.title).slice(0, COMPOSED_LIMITS.maxTitleChars);
      if (given) plan.title = given;
    }
  }
  const src = b.source;
  const source = src && typeof src === 'object' && !Array.isArray(src) ? (src as PickedComposedRequest['source']) : null;
  if (src !== undefined && src !== null && !source) problems.push('source: { call_id? | lesson_id?, label? }');
  return { plan, title: plan && typeof plan.title === 'string' ? plan.title.trim() : '', dryRun, source, problems };
}
