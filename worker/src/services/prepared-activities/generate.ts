/**
 * The prepared-activities generator: one forced-tool call (structuredCall,
 * thinking off) writes 4–6 in-call activities for the NEXT lesson with one
 * student from what their last lessons left behind; each is parsed and checked
 * with the shared engine's rules (parseGeneratedActivity → validateActivitySpec)
 * and the refused ones go back for up to two repair rounds. Whatever passes is
 * kept — a partial set is better than none.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from '../structured-call';
import { estimateCost } from '../analytics/ai-usage';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { studentProfilePrompt } from '@shared/students';
import { coveragePrompt } from '@shared/students/coverage';
import {
  DEFAULT_PREPARE_COUNT,
  MAX_PREPARE_COUNT,
  PREPARED_KINDS,
  parseGeneratedActivity,
  type ActivityLevel,
  type ActivitySpec,
  type ActivityWord,
} from '@shared/call-activities';
import type { ActivityContext } from './context';

export const PREPARE_MODEL = 'claude-sonnet-5';
const MAX_REPAIR_ROUNDS = 2;

export interface GeneratedActivity {
  spec: ActivitySpec;
  why: string;
}

export interface GenerateResult {
  activities: GeneratedActivity[];
  /** Activities refused even after repair (problems, for the log). */
  refused: { title: string; problems: string[] }[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  rounds: number;
}

const SPEC_DOC = `Each activity is ONE object. Common fields (all kinds):
- kind: describe | info_gap | roleplay | build | quiz | dictation
- title (English, ≤ 60 chars, e.g. "Dictation: last lesson's health words"), title_zh (short Chinese title)
- why: ONE short line for the tutor — what from the previous lessons this practises, concretely ("Last lesson: 把 sentences — 3 corrections", "Words she mixed up: 买 / 卖", "New words from 3 Oct: 头疼, 发烧…"). ≤ 120 chars.
- level: beginner | elementary | intermediate; topic (≤ 40 chars); summary: one line saying what the two of you do (shown to both).
- role_names { a, b } and tutor_role (a | b) — optional; the defaults are right for most activities.

Kinds and their content fields:
- describe — "Describe & guess": the STUDENT (role a, Describer) sees a word and describes it in Chinese without saying it; the tutor (b) guesses from up to 8 options. tutor_role "b".
  items: 6–8 × { emoji, hanzi, pinyin, english, hints: 2–3 short Chinese words / phrases the describer could use }, distractors: 4–6 × { hanzi, pinyin, english } of the same category (never an item), glossary: { hanzi, pinyin, english } for EVERY hint. Only concrete things / actions a learner can describe at their level.
- dictation — the tutor (a, Reader) says a word or phrase, the student (b, Writer) types it in characters. items: 6–8 × { hanzi, pinyin, english } — words or short phrases from the lessons (never long sentences).
- build — "Sentence building": both put scrambled word tiles in order, then say the sentence aloud. items: 4–6 × { tiles: the sentence split into 3–8 WORDS in the right order (punctuation off, a word per tile, e.g. ["我","把","书","放在","桌子上"]), pinyin (the whole sentence), english }. The best source: the corrected sentences ("better") of the last lesson, and sentences with its structures.
- quiz — the tutor (a, Asker) pushes each question, the student (b) picks; questions: 5–8 × { prompt (shown to both; "" for a pure listening question), audio? (Chinese text to play aloud — for listening / tone questions; then prompt may be ""), options: 2–4 distinct short strings, answer: the index of the right option, explanation: one line }. Good sources: words they mix up (买 / 卖), tone pairs, the right form vs the mistake they made ("Which is right?"), measure words, meanings of new words.
- roleplay — a scripted dialogue read turn by turn. setting (one line), speakers { a, b } (short Chinese role names, e.g. "医生" / "病人"), role_names { a, b } ("医生 Doctor"), tutor_role "a", lines: 8–12 × { speaker: a | b, hanzi, pinyin, english } — a natural conversation in the situation of the last lesson that USES its new words and structures; the student's part (b) carries the target language.
- info_gap — each person sees half of a small table and asks the other to fill the rest. prompt: what to ask, with a model question ("Ask: 小明星期六上午做什么？"), phrases: 2–3 × { hanzi, pinyin, english } (question / answer patterns), columns: 2 column headings, rows: 3–4 × { label, cells: one per column × { value (a choice's hanzi), owner: a | b — who can SEE it; about half each, mixed } }, choices: { hanzi, pinyin, english } for EVERY cell value plus 2–3 distractors.`;

const RULES = `Rules:
- Build every activity from THIS student's material below — the last lesson first: its new words, the corrections (the better forms), its topics and structures; then the words they struggle with or mix up, and recent homework words. Not generic textbook content.
- A mix: different kinds (use each kind at most once unless asked for more than six), about 5–10 minutes each in a call. Prefer: a dictation or describe of the last lesson's new words, a build of the corrected sentences, a quiz on mix-ups / mistakes, a role-play in the last lesson's situation.
- Pitch it at the student's level (the tutor's profile, else what they know). Simplified characters; pinyin with tone marks and spaces between words, 一 / 不 tone changes written (yí gè, bú shì); English short.
- Don't repeat an activity already prepared (titles listed below) or one already played in the last lesson.
- The student SEES the titles, summaries and content once an activity starts: never mention the tutor's private profile, the student's weaknesses by name ("because you are bad at…") or anything private there. The "why" line is only for the tutor — that is where to say why.
- Return the activities with the prepare_activities tool.`;

export function buildSystemPrompt(): string {
  return `You prepare in-call activities for a Chinese tutor's NEXT video lesson with one student. The activities are played together in the call — both people see them, each with their own role; the tutor runs them.\n\n${SPEC_DOC}\n\n${RULES}`;
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The user turn: the student's material, newest first. */
export function buildBriefing(ctx: ActivityContext, count: number): string {
  const { people } = ctx;
  const student = people.studentName?.trim() || 'the student';
  const out: string[] = [];
  out.push(`Student: ${student}. Tutor: ${people.tutorName?.trim() || 'the tutor'}.`);
  out.push(`Write ${count} activities.`);
  const profile = studentProfilePrompt(ctx.profile, people.studentName);
  if (profile) out.push('', profile);
  out.push('', coveragePrompt(ctx.coverage, people.studentName));

  if (ctx.lastLesson) {
    const { report, date } = ctx.lastLesson;
    out.push('', `# Last lesson (${date}) — the lesson report`);
    if (report.summary) out.push(`Summary: ${oneLine(report.summary, 800)}`);
    if (report.topics?.length) out.push(`Topics: ${report.topics.join('; ')}`);
    if (report.vocabulary?.length) {
      out.push('New vocabulary:');
      for (const v of report.vocabulary.slice(0, 30)) out.push(`- ${v.hanzi} (${v.pinyin}) ${v.english}${v.from_call ? ` — said: ${oneLine(v.from_call, 80)}` : ''}`);
    }
    if (report.corrections?.length) {
      out.push('Corrections (what the student said → the better form):');
      for (const c of report.corrections.slice(0, 15)) out.push(`- ${c.said} → ${c.better}${c.explanation ? ` (${oneLine(c.explanation, 140)})` : ''}`);
    }
    if (report.follow_ups?.length) out.push(`Follow-up ideas from the report: ${report.follow_ups.map((f) => oneLine(f, 160)).join(' | ')}`);
    if (ctx.lastLesson.boardText) out.push('', 'Whiteboard text of that lesson:', ctx.lastLesson.boardText);
    if (ctx.lastLesson.activities) out.push('', 'Activities already played in that lesson:', ctx.lastLesson.activities);
  } else {
    out.push('', '# Last lesson: no recorded video lesson yet.');
  }
  for (const n of ctx.newerNotes) {
    out.push('', `# Tutor's lesson notes (${n.date}${n.title ? `, "${n.title}"` : ''})`, n.notes);
  }
  if (ctx.earlierLesson) {
    const r = ctx.earlierLesson.report;
    out.push('', `# The lesson before (${ctx.earlierLesson.date})`);
    if (r.topics?.length) out.push(`Topics: ${r.topics.join('; ')}`);
    if (r.vocabulary?.length) out.push(`Words: ${r.vocabulary.slice(0, 20).map((v) => `${v.hanzi} (${v.english})`).join(', ')}`);
  }
  if (ctx.struggling.length) {
    out.push('', '# Struggling in study (last 3 weeks: word · meaning · forgot/attempts · wrong answers typed)');
    for (const s of ctx.struggling) out.push(`- ${s.hanzi} · ${s.english} · ${s.again}/${s.attempts}${s.wrong.length ? ` · typed ${s.wrong.join(', ')}` : ''}`);
  }
  if (ctx.mixUps.length) out.push('', `# Characters they mix up: ${ctx.mixUps.map((m) => `${m.a} ↔ ${m.b} (${m.count}×)`).join(', ')}`);
  if (ctx.homeworkWords.length) out.push('', `# Recent homework words: ${ctx.homeworkWords.slice(0, 30).map((w) => `${w.hanzi} (${w.english})`).join(', ')}`);
  if (ctx.existingTitles.length) out.push('', `# Already prepared (don't repeat): ${ctx.existingTitles.join(' | ')}`);
  return out.join('\n');
}

const WORD = { type: 'object', properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } }, required: ['hanzi', 'pinyin', 'english'] };

const ACTIVITY_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: PREPARED_KINDS },
    title: { type: 'string' },
    title_zh: { type: 'string' },
    why: { type: 'string' },
    level: { type: 'string', enum: ['beginner', 'elementary', 'intermediate'] },
    topic: { type: 'string' },
    summary: { type: 'string' },
    role_names: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
    tutor_role: { type: 'string', enum: ['a', 'b'] },
    items: {
      type: 'array',
      description: 'describe: { emoji, hanzi, pinyin, english, hints[] }; dictation: { hanzi, pinyin, english }; build: { tiles[], pinyin, english }',
      items: {
        type: 'object',
        properties: {
          emoji: { type: 'string' },
          hanzi: { type: 'string' },
          pinyin: { type: 'string' },
          english: { type: 'string' },
          hints: { type: 'array', items: { type: 'string' } },
          tiles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    distractors: { type: 'array', items: WORD },
    glossary: { type: 'array', items: WORD },
    prompt: { type: 'string' },
    phrases: { type: 'array', items: WORD },
    columns: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          cells: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, owner: { type: 'string', enum: ['a', 'b'] } }, required: ['value', 'owner'] } },
        },
        required: ['label', 'cells'],
      },
    },
    choices: { type: 'array', items: WORD },
    setting: { type: 'string' },
    speakers: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
    lines: { type: 'array', items: { type: 'object', properties: { speaker: { type: 'string', enum: ['a', 'b'] }, hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string' } }, required: ['speaker', 'hanzi', 'pinyin', 'english'] } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          audio: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['prompt', 'options', 'answer'],
      },
    },
  },
  required: ['kind', 'title', 'why', 'summary'],
};

export const PREPARE_TOOL = {
  name: 'prepare_activities',
  description: 'Return the in-call activities for the next lesson.',
  input_schema: {
    type: 'object' as const,
    properties: { activities: { type: 'array', items: ACTIVITY_SCHEMA } },
    required: ['activities'],
  },
};

function activitiesOf(input: unknown): unknown[] {
  const list = (input as { activities?: unknown })?.activities;
  if (!Array.isArray(list) || list.length === 0) throw new Error('No activities in the reply');
  return list;
}

/** 一 / 不 tone changes on every word-shaped thing (the app's one rule, shared/pinyin/toneChange.ts). */
export function fixActivityPinyin(spec: ActivitySpec): ActivitySpec {
  const fix = <T extends ActivityWord>(w: T): T => (w.pinyin ? { ...w, pinyin: applyYiBuToneChanges(w.hanzi, w.pinyin) } : w);
  switch (spec.kind) {
    case 'describe':
      return { ...spec, items: spec.items.map(fix), distractors: spec.distractors?.map(fix), glossary: spec.glossary?.map(fix) };
    case 'info_gap':
      return { ...spec, phrases: spec.phrases?.map(fix), choices: spec.choices.map(fix) };
    case 'roleplay':
      return { ...spec, lines: spec.lines.map(fix) };
    case 'dictation':
      return { ...spec, items: spec.items.map(fix) };
    case 'build':
      return { ...spec, items: spec.items.map((it) => (it.pinyin ? { ...it, pinyin: applyYiBuToneChanges(it.tiles.join(''), it.pinyin) } : it)) };
    default:
      return spec;
  }
}

/** The student's level for a spec's `level` (the profile's, "advanced" → intermediate). */
export function levelFor(ctx: ActivityContext): ActivityLevel {
  const l = ctx.profile?.level;
  if (l === 'beginner' || l === 'elementary' || l === 'intermediate') return l;
  if (l === 'advanced') return 'intermediate';
  return 'elementary';
}

export async function generatePreparedActivities(opts: {
  apiKey: string;
  ctx: ActivityContext;
  count?: number;
  /** Ids for the specs, in order (`prepared:<row id>` is set later by the call room). */
  idFor: (index: number) => string;
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<GenerateResult> {
  const count = Math.max(1, Math.min(MAX_PREPARE_COUNT, opts.count ?? DEFAULT_PREPARE_COUNT));
  const level = levelFor(opts.ctx);
  const result: GenerateResult = { activities: [], refused: [], input_tokens: 0, output_tokens: 0, cost_usd: 0, rounds: 0 };
  const onUsage = (u: { input_tokens: number; output_tokens: number }, model: string) => {
    result.input_tokens += u.input_tokens;
    result.output_tokens += u.output_tokens;
    result.cost_usd += estimateCost(model, u.input_tokens, u.output_tokens);
  };
  const common = {
    apiKey: opts.apiKey,
    model: PREPARE_MODEL,
    system: buildSystemPrompt(),
    tool: PREPARE_TOOL,
    maxTokens: 12_000,
    attempts: 2,
    timeoutMs: 180_000,
    onUsage,
    client: opts.client,
    sleep: opts.sleep,
  };

  let raw = await structuredCall({ ...common, user: buildBriefing(opts.ctx, count), validate: activitiesOf });
  result.rounds = 1;
  for (let round = 0; ; round++) {
    const refused: { raw: unknown; problems: string[] }[] = [];
    for (const item of raw) {
      if (result.activities.length >= count) break;
      const parsed = parseGeneratedActivity(item, opts.idFor(result.activities.length), level);
      if (parsed.spec) result.activities.push({ spec: fixActivityPinyin(parsed.spec), why: parsed.why });
      else refused.push({ raw: item, problems: parsed.problems });
    }
    if (refused.length === 0 || result.activities.length >= count || round >= MAX_REPAIR_ROUNDS) {
      result.refused = refused.map((r) => ({ title: String((r.raw as { title?: unknown })?.title ?? '?'), problems: r.problems }));
      break;
    }
    // Repair round: only the refused ones, with what's wrong with each.
    const repairUser = [
      'These activities were refused by the checker. Fix each one (keep its idea and content; change only what the problems say) and return the fixed ones with the prepare_activities tool.',
      ...refused.map((r, i) => `## Activity ${i + 1}\nProblems:\n${r.problems.map((p) => `- ${p}`).join('\n')}\nAs written:\n${JSON.stringify(r.raw)}`),
    ].join('\n\n');
    try {
      raw = await structuredCall({ ...common, user: repairUser, validate: activitiesOf });
      result.rounds++;
    } catch (err) {
      console.warn('[prepared-activities] repair round failed:', err instanceof Error ? err.message : err);
      result.refused = refused.map((r) => ({ title: String((r.raw as { title?: unknown })?.title ?? '?'), problems: r.problems }));
      break;
    }
  }
  return result;
}
