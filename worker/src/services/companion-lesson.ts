/**
 * The companion MINI LESSON of an audio lesson (docs/AUDIO_LESSONS.md "Companion mini lesson",
 * shared/lesson/unlock.ts): Claude writes a ~10–15 minute lesson that drills the podcast's own
 * characters, sentences and meanings — notes on each new word (every character with its tone and
 * meaning), word / tone / sentence exercises on the dialogue's lines, and the dialogue replayed as
 * a conversation exercise with comprehension questions. It is created LOCKED: it waits until the
 * podcast has been listened to (or the learner says they've done the real-world thing).
 *
 * `POST /api/audio-lessons/:id/companion-lesson` marks the audio lesson `companion_status =
 * 'generating'` and puts `{ lessonId, companion: true }` on audio-lesson-queue; `runCompanionJob`
 * writes the spec (validated with validateLessonSpec, up to two repair rounds, the 一 / 不 tone
 * changes applied to every pinyin) and creates the lesson — or, when the audio lesson already has
 * a companion nobody has started, replaces its content in place (same id). A started companion is
 * never regenerated. One companion per audio lesson.
 *
 * Only READS the audio lesson (plan, words, transcript); nothing here touches how audio lessons
 * are written or spoken.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  companionLessonTitle,
  validateLessonSpec,
  type CustomLessonSpec,
  type LessonUnlock,
} from '@shared/lesson';
import { applyYiBuToneChanges, pinyinSyllables, YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { hanCharsOf } from '@shared/audio-lesson/tones';
import type { DialoguePlan, LessonWord, SleepPlan, StoryPlan, AudioLessonFormat } from '@shared/audio-lesson/types';
import type { Env } from '../types';
import { LESSON_SPEC_INPUT_SCHEMA, createCustomLessonFromSpec, updateCustomLessonFromSpec } from './custom-lesson';
import { LESSON_SPEC_SCHEMA_TEXT, LESSON_STYLE_RULES } from './lesson-editor';
import { companionLessonRows } from './lesson-unlock';
import { trackServer } from './analytics/server-events';

const MODEL = 'claude-sonnet-5';
const MAX_REPAIR_ROUNDS = 2;
const TOOL = 'create_lesson_spec';

/** audio-lesson-queue message for a companion (the audio lesson's own builds are `{ lessonId }`). */
export interface CompanionJobMessage {
  lessonId: string;
  companion: true;
}

/** What the request asked for (audio_lessons.companion_request). */
export interface CompanionRequest {
  unlock: 'audio' | 'manual';
  prompt?: string | null;
}

/** The columns of an audio lesson this reads. */
export interface CompanionSourceRow {
  id: string;
  user_id: string;
  title: string;
  format: AudioLessonFormat;
  status: string;
  plan_json: string | null;
  words_json: string | null;
  companion_status?: string | null;
  companion_request?: string | null;
  companion_started_at?: string | null;
  companion_error?: string | null;
  listened_at?: string | null;
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** "饭 fàn · 菜 cài" — each character with the syllable the word's pinyin gives it (when they line up). */
function charLine(hanzi: string, pinyin: string): string {
  const chars = hanCharsOf(hanzi);
  const syls = pinyinSyllables(pinyin) ?? [];
  if (!chars.length) return '';
  return chars.map((c, i) => (syls.length === chars.length ? `${c} ${syls[i]}` : c)).join(' · ');
}

function wordLine(w: { hanzi: string; pinyin: string; english: string }): string {
  const chars = charLine(w.hanzi, w.pinyin);
  return `- ${w.hanzi} | ${w.pinyin} | ${w.english}${chars && hanCharsOf(w.hanzi).length > 1 ? `  (characters: ${chars})` : ''}`;
}

/**
 * The audio lesson as Claude needs it: the title, the words it taught, and its Chinese
 * (dialogue lines with speakers / sleep words with their sentences / story chunks).
 */
export function companionBrief(row: CompanionSourceRow): string {
  const words = parse<LessonWord[]>(row.words_json, []);
  const parts: string[] = [`Audio lesson: "${row.title}" (format: ${row.format}).`];
  if (row.format === 'dialogue') {
    const plan = parse<DialoguePlan | null>(row.plan_json, null);
    if (plan) {
      parts.push(`Situation (the host's intro): ${plan.intro_en}`);
      const names = new Map(plan.speakers.map(s => [s.id, s]));
      parts.push(
        `Speakers: ${plan.speakers.map(s => `${s.id} = ${s.name} (${s.gender})`).join(', ')}`,
        'The dialogue, line by line (speaker | hanzi | pinyin | english):',
        ...plan.dialogue.map((l, i) => `${i}. ${names.get(l.speaker)?.name ?? l.speaker} | ${l.hanzi} | ${l.pinyin} | ${l.english}`),
        'The points the podcast taught (most important first; kind, status = what the learner\'s cards said):',
        ...plan.points.map(p => `${wordLine(p)}  [${p.kind}, ${p.status}] — ${p.explanation_en}${p.example ? `  Example: ${p.example.hanzi} | ${p.example.pinyin} | ${p.example.english}` : ''}`),
      );
    }
  } else if (row.format === 'sleep') {
    const plan = parse<SleepPlan | null>(row.plan_json, null);
    if (plan) {
      parts.push('The new words it taught, each with its example sentences:');
      for (const w of plan.words) {
        parts.push(wordLine(w), ...w.sentences.map(s => `    · ${s.hanzi} | ${s.pinyin} | ${s.english}`));
      }
    }
  } else if (row.format === 'story') {
    const plan = parse<StoryPlan | null>(row.plan_json, null);
    if (plan) {
      parts.push(
        `Speakers: ${plan.speakers.map(s => `${s.label} (${s.gender})`).join(', ') || 'narration only'}`,
        'The story, chunk by chunk (speaker | hanzi | pinyin | english):',
        ...plan.chunks.slice(0, 80).map((c, i) => `${i}. ${c.speaker ?? '—'} | ${c.hanzi} | ${c.pinyin} | ${c.english}`),
      );
    }
  }
  if (words.length) {
    parts.push('Words listed for the lesson (status = the learner\'s cards when it was made):', ...words.map(w => `${wordLine(w)}${w.status ? `  [${w.status}]` : ''}`));
  }
  return parts.join('\n');
}

export const COMPANION_SYSTEM = `You write the COMPANION MINI LESSON of an audio lesson (a podcast) in a Chinese-learning app. The learner has just listened to the podcast; this lesson drills exactly its characters, sentences and meanings — nothing new. It takes about 10–15 minutes on a phone. Return the whole lesson with the ${TOOL} tool.

Build it like this (3–4 sections, 14–22 exercises in all):
1. "New words" — one "note" per new word or structure from the podcast (the most important first, 4–8 of them): body = the word, its meaning and EACH CHARACTER on its own line with its own tone and meaning, e.g. "饭 fàn — 4th tone — cooked rice; a meal" (a one-character word: that character); then one line on how it is used. sentences = the podcast line that uses it (+ the podcast's example if there is one), with pinyin and english.
2. "Words and tones" — a match exercise (hanzi ↔ English, 4–8 pairs from the podcast's words), 2–3 listen_choice exercises on the words that sound alike or whose tones are easy to mix up (options = the right word and look-alikes / sound-alikes with different tones; question in English, e.g. "Which word did you hear?"), 1–2 choice exercises on meanings.
3. "Sentences from the podcast" — use the podcast's OWN lines (copied exactly, not rewritten): 2–3 scramble, 2 translate (EN→ZH), 1–2 dictation (input "type"), 1 speak (say a sentence of your own in the same situation, with an example from the podcast).
4. "The whole conversation" (dialogue / story podcasts with speakers) — a conversation exercise replaying the podcast's dialogue: the same lines in order (up to 24; pick a coherent stretch when longer), the same speaker names (Chinese + English role), voice "female" / "male" by their gender, pinyin + english on every line, and 3–4 comprehension questions in English about what happened (multiple choice). A sleep podcast (word list, no dialogue) ends instead with a sentence_making exercise using 2–3 of its words.
The learner has heard everything already, so notes may quote the podcast; put the conversation LAST.

Pinyin: tone-marked, spaces between words, and the 一 / 不 tone changes written: ${YI_BU_CONVENTION}
Use only words and sentences from the podcast (and very common words); simplified characters; mainland usage.

${LESSON_STYLE_RULES}

${LESSON_SPEC_SCHEMA_TEXT}`;

/** Every { hanzi, pinyin } pair (and reference_hanzi / reference_pinyin) through the 一 / 不 rule. */
export function applyYiBuToSpec<T>(spec: T): T {
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.hanzi === 'string' && typeof o.pinyin === 'string') o.pinyin = applyYiBuToneChanges(o.hanzi, o.pinyin);
    if (typeof o.reference_hanzi === 'string' && typeof o.reference_pinyin === 'string') {
      o.reference_pinyin = applyYiBuToneChanges(o.reference_hanzi, o.reference_pinyin);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(spec);
  return spec;
}

/** Shape checks on top of validateLessonSpec, sent back as a repair round. */
export function companionSpecProblems(spec: CustomLessonSpec, format: AudioLessonFormat): string[] {
  const types = spec.sections.flatMap(s => s.exercises.map(e => e.type));
  const count = (t: string) => types.filter(x => x === t).length;
  const problems: string[] = [];
  if (types.length < 10) problems.push(`the lesson has ${types.length} exercises; a companion lesson needs 14–22 (about 10–15 minutes)`);
  if (count('note') < 2) problems.push('start with a "note" per new word: each character with its tone and meaning');
  for (const t of ['scramble', 'translate', 'listen_choice', 'dictation']) {
    if (count(t) < 1) problems.push(`add at least one "${t}" exercise on the podcast's own words / sentences`);
  }
  if (format !== 'sleep' && count('conversation') < 1) problems.push('end with a "conversation" exercise replaying the podcast\'s dialogue with comprehension questions');
  return problems;
}

type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

function isRetryable(error: unknown): boolean {
  return error instanceof Anthropic.APIError && (error.status === 429 || error.status === 503 || error.status === 529 || error.status >= 500);
}

async function withRetry(create: CreateMessage, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      return await create(params);
    } catch (err) {
      last = err;
      if (!isRetryable(err)) break;
    }
  }
  throw last instanceof Error ? last : new Error('Claude request failed');
}

/**
 * Write the companion spec: forced tool, thinking off, validated + companion shape checks, up to
 * two repair rounds. The title is the podcast's (`companionLessonTitle`), whatever Claude wrote.
 */
export async function generateCompanionSpec(
  row: CompanionSourceRow,
  create: CreateMessage,
): Promise<{ spec: CustomLessonSpec; rounds: number }> {
  const title = companionLessonTitle(row.title);
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Write the companion mini lesson of this podcast. Its title is exactly "${title}".\n\n${companionBrief(row)}`,
    },
  ];
  let lastErrors: string[] = [];
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const response = await withRetry(create, {
      model: MODEL,
      max_tokens: 20000,
      thinking: { type: 'disabled' },
      system: COMPANION_SYSTEM,
      tools: [{ name: TOOL, description: 'Return the complete lesson spec.', input_schema: LESSON_SPEC_INPUT_SCHEMA as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: TOOL },
      messages,
    });
    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') throw new Error('The lesson came back cut off (too long)');
      throw new Error('No lesson in the reply');
    }
    const raw = toolUse.input as CustomLessonSpec;
    if (raw && typeof raw === 'object') {
      raw.title = title;
      if (!raw.icon) raw.icon = '🎧';
      applyYiBuToSpec(raw);
    }
    const errors = validateLessonSpec(raw);
    const shape = errors.length === 0 ? companionSpecProblems(raw, row.format) : [];
    // Shape problems only cost a repair round while there are rounds left; the last round's valid spec is kept.
    if (errors.length === 0 && (shape.length === 0 || round === MAX_REPAIR_ROUNDS)) return { spec: raw, rounds: round + 1 };
    lastErrors = errors.length ? errors : shape;
    if (round === MAX_REPAIR_ROUNDS) break;
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Not right yet. Fix every problem below and call ${TOOL} again with the COMPLETE corrected spec:\n${lastErrors.map(e => `- ${e}`).join('\n')}`,
        }],
      },
    );
  }
  throw new Error(`Could not write a valid lesson: ${lastErrors.slice(0, 4).join('; ')}`);
}

/** E2E_TEST_MODE: a deterministic companion from the plan (no Claude call). */
export function fakeCompanionSpec(row: CompanionSourceRow): CustomLessonSpec {
  const words = parse<LessonWord[]>(row.words_json, []);
  const plan = parse<DialoguePlan | null>(row.format === 'dialogue' ? row.plan_json : null, null);
  const lines = plan?.dialogue ?? [];
  const w = words.length ? words : [{ hanzi: '吃饭', pinyin: 'chī fàn', english: 'to eat' }, { hanzi: '朋友', pinyin: 'péngyou', english: 'friend' }];
  const first = lines[0] ?? { hanzi: '我们吃饭吧。', pinyin: 'wǒmen chī fàn ba.', english: "Let's eat." };
  const pairs = w.slice(0, 6).filter((x, i, all) => all.findIndex(y => y.hanzi === x.hanzi || y.english === x.english) === i);
  const exercises: CustomLessonSpec['sections'] = [
    {
      title: 'New words',
      exercises: w.slice(0, 4).map(x => ({ type: 'note' as const, title: x.hanzi, body: `${x.hanzi} ${x.pinyin} — ${x.english}`, sentences: [{ hanzi: first.hanzi, pinyin: first.pinyin, english: first.english }] })),
    },
    {
      title: 'Words and tones',
      exercises: [
        ...(pairs.length >= 2 ? [{ type: 'match' as const, pairs: pairs.map(x => ({ hanzi: x.hanzi, pinyin: x.pinyin, english: x.english })) }] : []),
        { type: 'listen_choice' as const, audio: { hanzi: w[0].hanzi, pinyin: w[0].pinyin }, question: 'Which word did you hear?', options: [{ hanzi: w[0].hanzi }, { hanzi: '朋友们' }], correct: 0 },
      ],
    },
    {
      title: 'Sentences from the podcast',
      exercises: [
        { type: 'translate' as const, english: first.english, reference_hanzi: first.hanzi, reference_pinyin: first.pinyin },
        { type: 'dictation' as const, audio: { hanzi: first.hanzi, pinyin: first.pinyin, english: first.english } },
      ],
    },
  ];
  if (lines.length >= 2 && plan) {
    const idx = new Map(plan.speakers.map((s, i) => [s.id, i]));
    exercises.push({
      title: 'The whole conversation',
      exercises: [{
        type: 'conversation' as const,
        situation: plan.intro_en.slice(0, 200),
        speakers: plan.speakers.slice(0, 2).map(s => ({ name: s.name, voice: s.gender === 'male' ? 'male' as const : 'female' as const })),
        lines: lines.slice(0, 24).map(l => ({ speaker: Math.min(1, idx.get(l.speaker) ?? 0), hanzi: l.hanzi, pinyin: l.pinyin, english: l.english })),
        questions: [{ question: 'Who is speaking first?', options: plan.speakers.slice(0, 2).map(s => s.name), correct: 0 }],
      }],
    });
  }
  return applyYiBuToSpec({ title: companionLessonTitle(row.title), icon: '🎧', description: `Drills the words and sentences of “${row.title}”.`, sections: exercises });
}

/** The unlock condition a request makes. */
export function companionUnlock(row: { id: string; title: string }, req: CompanionRequest): LessonUnlock {
  if (req.unlock === 'manual') {
    const prompt = (req.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || `Listen to “${row.title}”`;
    return { kind: 'manual', prompt };
  }
  return { kind: 'audio_lesson', audio_lesson_id: row.id };
}

async function loadSource(db: D1Database, audioLessonId: string): Promise<CompanionSourceRow | null> {
  return (await db
    .prepare(
      `SELECT id, user_id, title, format, status, plan_json, words_json, companion_status, companion_request, companion_started_at, companion_error, listened_at
       FROM audio_lessons WHERE id = ? AND format IS NOT NULL`,
    )
    .bind(audioLessonId)
    .first<CompanionSourceRow>()) ?? null;
}

export type CompanionJobOutcome = 'created' | 'replaced' | 'kept' | 'failed' | 'gone';

/**
 * The queue job: write the spec, then create the companion locked to its unlock condition, or
 * replace the content of the not-yet-started companion in place. Failures are written to the
 * audio lesson (`companion_status = 'failed'`, `companion_error`) and never thrown.
 */
export async function runCompanionJob(
  env: Env,
  audioLessonId: string,
  deps: { create?: CreateMessage } = {},
): Promise<CompanionJobOutcome> {
  const row = await loadSource(env.DB, audioLessonId);
  if (!row) return 'gone';
  const req = parse<CompanionRequest>(row.companion_request, { unlock: 'audio' });
  const fail = async (message: string): Promise<CompanionJobOutcome> => {
    await env.DB.prepare(`UPDATE audio_lessons SET companion_status = 'failed', companion_error = ? WHERE id = ?`).bind(message.slice(0, 300), row.id).run();
    return 'failed';
  };
  try {
    const existing = (await companionLessonRows(env.DB, row.user_id, [row.id])).get(row.id);
    if (existing && existing.finishes > 0) {
      await env.DB.prepare(`UPDATE audio_lessons SET companion_status = NULL, companion_error = NULL WHERE id = ?`).bind(row.id).run();
      return 'kept';
    }
    let spec: CustomLessonSpec;
    let rounds = 0;
    if (env.E2E_TEST_MODE === 'true' && !deps.create) {
      spec = fakeCompanionSpec(row);
    } else {
      if (!env.ANTHROPIC_API_KEY && !deps.create) return await fail('The Claude key is not configured on the server');
      const client = deps.create ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const create: CreateMessage = deps.create ?? (params => client!.messages.create(params));
      ({ spec, rounds } = await generateCompanionSpec(row, create));
    }
    const unlock = companionUnlock(row, req);
    let outcome: CompanionJobOutcome;
    let lessonId: string;
    if (existing) {
      const res = await updateCustomLessonFromSpec(env, row.user_id, existing.id, spec);
      if (!res.ok) return await fail(res.errors.slice(0, 3).join('; ') || 'Could not save the lesson');
      lessonId = existing.id;
      // The condition follows the latest request; a lesson already unlocked stays unlocked.
      await env.DB
        .prepare(`UPDATE custom_lessons SET unlock_kind = ?, unlock_ref = ?, unlock_prompt = ? WHERE id = ? AND user_id = ?`)
        .bind(unlock.kind, unlock.kind === 'audio_lesson' ? unlock.audio_lesson_id : null, unlock.kind === 'manual' ? unlock.prompt : null, existing.id, row.user_id)
        .run();
      outcome = 'replaced';
    } else {
      const res = await createCustomLessonFromSpec(env, row.user_id, spec, 'companion', { unlock, companionOf: row.id });
      if (!res.ok) return await fail(res.errors.slice(0, 3).join('; ') || 'Could not save the lesson');
      lessonId = res.lesson.id;
      outcome = 'created';
    }
    await env.DB.prepare(`UPDATE audio_lessons SET companion_status = NULL, companion_error = NULL WHERE id = ?`).bind(row.id).run();
    const exercises = spec.sections.reduce((n, s) => n + s.exercises.length, 0);
    void trackServer('lesson.companion_created', { unlock: unlock.kind, format: row.format, exercises, rounds, replaced: outcome === 'replaced' }, { env, userId: row.user_id });
    console.log('[companion] lesson', lessonId, outcome, 'for audio lesson', row.id);
    return outcome;
  } catch (err) {
    console.error('[companion] failed for audio lesson', row.id, err);
    return await fail(err instanceof Error ? err.message : String(err));
  }
}

export type CompanionRequestResult =
  | { status: 202 | 200; started: boolean; existing: boolean }
  | { status: 400 | 404 | 409 | 503; error: string };

/**
 * Ask for a companion: the audio lesson must be the caller's and ready. A started companion is
 * kept (200, existing); one being written is left to finish (202); otherwise the job is queued.
 */
export async function requestCompanionLesson(
  env: Env,
  userId: string,
  audioLessonId: string,
  body: { unlock?: unknown; prompt?: unknown },
  start: (msg: CompanionJobMessage) => Promise<void>,
): Promise<CompanionRequestResult> {
  const row = await loadSource(env.DB, audioLessonId);
  if (!row || row.user_id !== userId) return { status: 404, error: 'Not found' };
  if (row.status !== 'ready') return { status: 409, error: 'The audio lesson is still being made — ask again once it is ready' };
  const unlock = body.unlock === undefined ? 'audio' : body.unlock;
  if (unlock !== 'audio' && unlock !== 'manual') return { status: 400, error: 'unlock must be "audio" or "manual"' };
  if (body.prompt !== undefined && body.prompt !== null && (typeof body.prompt !== 'string' || body.prompt.length > 200)) {
    return { status: 400, error: 'prompt must be a short text (≤ 200 characters)' };
  }
  const existing = (await companionLessonRows(env.DB, userId, [row.id])).get(row.id);
  if (existing && existing.finishes > 0) return { status: 200, started: true, existing: true };
  const startedAt = Date.parse(row.companion_started_at ?? '');
  if (row.companion_status === 'generating' && Number.isFinite(startedAt) && Date.now() - startedAt < 20 * 60 * 1000) {
    return { status: 202, started: false, existing: !!existing };
  }
  if (!env.ANTHROPIC_API_KEY && env.E2E_TEST_MODE !== 'true') return { status: 503, error: 'Companion lessons need the Claude key, which is not configured on the server' };
  const request: CompanionRequest = { unlock, prompt: typeof body.prompt === 'string' ? body.prompt : null };
  await env.DB
    .prepare(`UPDATE audio_lessons SET companion_status = 'generating', companion_error = NULL, companion_started_at = ?, companion_request = ? WHERE id = ?`)
    .bind(new Date().toISOString(), JSON.stringify(request), row.id)
    .run();
  await start({ lessonId: row.id, companion: true });
  return { status: 202, started: false, existing: !!existing };
}
