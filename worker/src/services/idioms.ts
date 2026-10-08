/**
 * 成语 Idioms (beta; docs/IDIOMS.md). One entry per idiom, generated once by Claude and shared
 * by every account (D1 `idioms`, keyed by normalizeIdiomHanzi). Generation is one long
 * structured call (story with pinyin + English, usage, examples, quiz), so it runs on
 * `idiom-queue` — not in the request — and clients poll `GET /api/idioms/:hanzi`.
 *
 * Facts first: the prompt tells Claude never to invent a source, to mark an uncertain or
 * modern origin as such, and to rate its own confidence; the validator (shared/idioms) cleans
 * the pinyin (一 / 不 tone changes), drops examples that break the card standard and refuses an
 * entry too broken to read (structuredCall retries it).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD } from '@shared/cards/standard';
import {
  IDIOM_GENERATOR_VERSION,
  IDIOM_ROLES,
  STARTER_IDIOMS,
  checkIdiomEntry,
  starterIdiom,
  validateIdiomGeneration,
  type IdiomEntry,
  type IdiomGeneration,
  type IdiomRecord,
  type IdiomStatus,
  type IdiomSummary,
} from '@shared/idioms';
import type { Env } from '../types';
import { structuredCall, StructuredCallError } from './structured-call';
import { fakeIdiomClient } from './idioms-fake';

export const IDIOM_MODEL = 'claude-sonnet-5';
/** A generating row older than this is reported failed (Retry shows). */
export const IDIOM_STALE_MINUTES = 10;

export interface IdiomQueueMessage {
  hanzi: string;
}

type IdiomEnv = Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'> & Partial<Pick<Env, 'IDIOM_QUEUE'>>;

/** Can an idiom be generated here (a key, or the E2E stand-in)? */
export function idiomsAvailable(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return !!env.ANTHROPIC_API_KEY || env.E2E_TEST_MODE === 'true';
}

// ---------- The prompt ----------

const LINE = {
  type: 'object',
  properties: {
    hanzi: { type: 'string' },
    pinyin: { type: 'string', description: 'tone marks, spaces between words' },
    english: { type: 'string' },
  },
  required: ['hanzi', 'pinyin', 'english'],
} as const;
const REF = {
  type: 'object',
  properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, english: { type: 'string', description: 'short meaning' } },
  required: ['hanzi', 'pinyin', 'english'],
} as const;

export const IDIOM_TOOL: { name: string; description: string; input_schema: Anthropic.Tool.InputSchema } = {
  name: 'write_idiom_entry',
  description: 'Write the idiom explorer entry for the requested 成语 — or say it is not one.',
  input_schema: {
    type: 'object',
    properties: {
      is_idiom: { type: 'boolean', description: 'false when the text is not a 成语 / set idiomatic expression' },
      not_idiom_reason: { type: 'string', description: 'is_idiom false: one short English sentence why' },
      did_you_mean: { type: 'string', description: 'is_idiom false: the real 成语 it is probably a typo of, else empty' },
      hanzi: { type: 'string', description: 'the idiom exactly as requested (simplified)' },
      pinyin: { type: 'string', description: 'one syllable per character, spaced: huà shé tiān zú' },
      literal: {
        type: 'array',
        description: 'one item per character, in order',
        items: { type: 'object', properties: { hanzi: { type: 'string' }, pinyin: { type: 'string' }, gloss: { type: 'string', description: 'its meaning HERE, 1–4 English words' } }, required: ['hanzi', 'pinyin', 'gloss'] },
      },
      literal_english: { type: 'string', description: 'the literal meaning as one English phrase' },
      meaning: { type: 'string', description: 'the figurative meaning in plain English (one line)' },
      explanation_zh: { type: 'string', description: 'one short line in simple Chinese (HSK 3–4): what it means' },
      explanation_pinyin: { type: 'string' },
      origin: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['classical', 'folk', 'modern', 'uncertain'] },
          source: { type: 'string', description: 'the source text, e.g. 《战国策·齐策二》 — ONLY when you are sure; else empty' },
          era: { type: 'string', description: 'e.g. 战国 (Warring States) — only when sure; else empty' },
          summary: { type: 'string', description: 'the story (or how the image works) in ONE English sentence' },
          story: { type: 'array', items: LINE, description: 'the 典故 retold in simple Chinese: 3–6 short paragraphs' },
          note: { type: 'string', description: 'honesty note when the origin is uncertain, disputed or modern; else empty' },
        },
        required: ['kind', 'summary', 'story'],
      },
      usage: {
        type: 'object',
        properties: {
          roles: { type: 'array', items: { type: 'string', enum: Object.keys(IDIOM_ROLES) }, description: 'grammatical roles, most typical first' },
          register: { type: 'string', enum: ['written', 'spoken', 'both'], description: '书面 / 口语 / both' },
          sentiment: { type: 'string', enum: ['praise', 'criticism', 'neutral'], description: '褒义 / 贬义 / 中性' },
          note: { type: 'string', description: 'one English line: when and how it is used' },
          collocations: { type: 'array', items: LINE, description: '2–4 typical collocations containing the idiom' },
          examples: { type: 'array', items: LINE, description: '3–4 sentences, easiest → hardest, each containing the idiom EXACTLY' },
          mistake: { type: 'string', description: 'the most common learner mistake with it, in English' },
        },
        required: ['roles', 'register', 'sentiment', 'note', 'collocations', 'examples', 'mistake'],
      },
      synonyms: { type: 'array', items: REF, description: '近义 idioms, up to 3 real ones' },
      antonyms: { type: 'array', items: REF, description: '反义 idioms, up to 3 real ones' },
      quiz: {
        type: 'array',
        description: '2–3 multiple-choice questions',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['meaning', 'fit'] },
            prompt: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'integer', description: 'index of the correct option' },
            explanation: { type: 'string', description: 'one line shown after answering' },
          },
          required: ['kind', 'prompt', 'options', 'answer', 'explanation'],
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      confidence_note: { type: 'string', description: 'why not high; else empty' },
    },
    required: ['is_idiom'],
  },
};

export const IDIOM_SYSTEM = `You write entries for the 成语 (Chinese idiom) explorer of a Chinese-learning app. The readers are English-speaking learners around HSK 3–4 who read the entry on their own: the meaning, the story behind it (典故) and how to use it.

FACTS FIRST — this matters more than anything else:
- Give origin.source (《书名·篇名》) and origin.era ONLY when they are the well-established source of this idiom and you are sure. Never invent a book, chapter, author, person or event.
- If sources differ, or you are unsure where it comes from, set origin.kind "uncertain", leave source empty, say so plainly in origin.note, and lower confidence.
- A modern coinage → kind "modern". A descriptive idiom with no single story (五颜六色, 人山人海) → kind "folk" (or "modern"), and the story explains how the picture in it works in 1–2 short paragraphs instead of an invented anecdote; origin.note says there is no single story.
- Retell a classical story faithfully: keep its people, place and outcome. Simplify the language, never the facts.
- confidence: "high" = a famous idiom whose source and story you know well; "medium" = sure of the meaning, less sure of origin details; "low" = rare, or unsure. Explain medium / low in confidence_note.

THE STORY (origin.story): simple modern Chinese at HSK 3–4 — common words, short sentences — in 3–6 short paragraphs of 1–3 sentences (at most ~80 characters each). Every paragraph has pinyin and a natural English translation. The last paragraph says how the idiom came to mean what it means now.

USAGE: roles from ${Object.keys(IDIOM_ROLES).join(' ')}; register; sentiment (褒义 = praise, 贬义 = criticism, 中性 = neutral); 2–4 collocations; 3–4 example sentences ordered easiest → hardest, each containing the idiom EXACTLY as written, the first short and at HSK 3; and the one mistake learners most often make with it (wrong sentiment, wrong collocation, confusing it with a look-alike).

近义 / 反义: up to 3 REAL, well-known idioms each — an empty list is better than a made-up one.

QUIZ: 2–3 questions: one "meaning" (prompt like "画蛇添足 means…", 3–4 English options, plausible distractors), one "fit" ("Which sentence uses 画蛇添足 correctly?", 3 Chinese sentences, only one right). answer = the index of the correct option; don't always put it first.

NOT AN IDIOM: when the text is not a 成语 or set idiomatic expression, answer is_idiom false with not_idiom_reason, and did_you_mean when it looks like a typo of a real one. Leave everything else empty. When it is one, answer is_idiom true and fill every field; hanzi = the requested text.

PINYIN and every Chinese line follow the card standard below (tone marks; the 一 / 不 tone changes written; no other sandhi; no brackets, slashes or blanks in example sentences).

${CARD_STANDARD}`;

/**
 * Generate one entry (or "not an idiom"). Long output → a generous token budget and timeout;
 * no Haiku fallback: a wrong 典故 is worse than a "try again".
 */
export async function generateIdiomEntry(opts: { apiKey: string; hanzi: string; client?: Pick<Anthropic, 'messages'>; sleep?: (ms: number) => Promise<void> }): Promise<IdiomGeneration> {
  const starter = starterIdiom(opts.hanzi);
  return structuredCall({
    apiKey: opts.apiKey,
    model: IDIOM_MODEL,
    fallbackModel: null,
    system: IDIOM_SYSTEM,
    user: `Write the entry for: ${opts.hanzi}${starter ? `\n(For orientation: ${starter.pinyin} — ${starter.english}.)` : ''}`,
    tool: IDIOM_TOOL,
    maxTokens: 6000,
    attempts: 3,
    timeoutMs: 150_000,
    validate: (input) => validateIdiomGeneration(input, opts.hanzi),
    client: opts.client,
    sleep: opts.sleep,
  });
}

// ---------- Rows ----------

interface IdiomRow {
  hanzi: string;
  status: string;
  entry: string | null;
  error: string | null;
  suggestion: string | null;
  attempts: number;
  generator_version: number;
  started_at: string | null;
  updated_at: string | null;
}

function parseEntry(json: string | null, hanzi: string): IdiomEntry | null {
  if (!json) return null;
  try {
    return checkIdiomEntry(JSON.parse(json), hanzi).entry;
  } catch {
    return null;
  }
}

export function rowToRecord(row: IdiomRow | null, hanzi: string): IdiomRecord {
  if (!row) return { hanzi, status: 'missing', entry: null, error: null, suggestion: null, generator_version: IDIOM_GENERATOR_VERSION, updated_at: null };
  const entry = row.status === 'ready' ? parseEntry(row.entry, row.hanzi) : null;
  const status = (row.status === 'ready' && !entry ? 'failed' : row.status) as IdiomStatus;
  return {
    hanzi: row.hanzi,
    status,
    entry,
    error: status === 'failed' ? row.error || 'Something went wrong writing this idiom — try again.' : row.error,
    suggestion: row.suggestion,
    generator_version: row.generator_version,
    updated_at: row.updated_at,
  };
}

/** A generating row that outlived any delivery → failed, so the client shows Retry. */
async function sweepStale(db: D1Database, hanzi?: string): Promise<void> {
  await db
    .prepare(
      `UPDATE idioms SET status = 'failed', error = 'Writing this idiom took too long — try again.', updated_at = datetime('now')
        WHERE status = 'generating' AND COALESCE(started_at, created_at) < datetime('now', '-${IDIOM_STALE_MINUTES} minutes')${hanzi ? ' AND hanzi = ?' : ''}`,
    )
    .bind(...(hanzi ? [hanzi] : []))
    .run();
}

export async function getIdiom(db: D1Database, hanzi: string): Promise<IdiomRecord> {
  await sweepStale(db, hanzi);
  const row = await db.prepare('SELECT * FROM idioms WHERE hanzi = ?').bind(hanzi).first<IdiomRow>();
  return rowToRecord(row, hanzi);
}

/** Opened (ready only) — list ordering; never fails the read. */
export async function countIdiomView(db: D1Database, hanzi: string): Promise<void> {
  await db.prepare(`UPDATE idioms SET view_count = view_count + 1 WHERE hanzi = ? AND status = 'ready'`).bind(hanzi).run().catch(() => undefined);
}

/**
 * The browsable list: every starter idiom (with its status here) and the other generated
 * entries, most opened first.
 */
export async function listIdioms(db: D1Database, opts: { limit?: number } = {}): Promise<{ starter: IdiomSummary[]; more: IdiomSummary[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 300);
  const rows = await db
    .prepare(`SELECT hanzi, status, entry FROM idioms WHERE status IN ('ready', 'generating', 'failed') ORDER BY view_count DESC, updated_at DESC LIMIT ?`)
    .bind(limit + STARTER_IDIOMS.length)
    .all<{ hanzi: string; status: string; entry: string | null }>();
  const byHanzi = new Map((rows.results ?? []).map((r) => [r.hanzi, r]));
  const starter: IdiomSummary[] = STARTER_IDIOMS.map((s) => ({
    hanzi: s.hanzi,
    pinyin: s.pinyin,
    english: s.english,
    status: (byHanzi.get(s.hanzi)?.status as IdiomStatus | undefined) ?? 'missing',
    starter: true,
  }));
  const more: IdiomSummary[] = [];
  for (const r of rows.results ?? []) {
    if (r.status !== 'ready' || starterIdiom(r.hanzi)) continue;
    const entry = parseEntry(r.entry, r.hanzi);
    if (!entry) continue;
    more.push({ hanzi: r.hanzi, pinyin: entry.pinyin, english: entry.meaning, status: 'ready', starter: false });
    if (more.length >= limit) break;
  }
  return { starter, more };
}

// ---------- Request + job ----------

/**
 * Get-or-generate: a ready / generating row is returned as is; a missing or failed one (or
 * not_idiom with `retry`) is (re)started and queued. Without the queue binding (tests, E2E)
 * the job runs in waitUntil.
 */
export async function requestIdiom(
  env: IdiomEnv,
  hanzi: string,
  opts: { retry?: boolean; waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<{ record: IdiomRecord; started: boolean }> {
  const current = await getIdiom(env.DB, hanzi);
  const keep = current.status === 'ready' || current.status === 'generating' || (current.status === 'not_idiom' && !opts.retry);
  if (keep) return { record: current, started: false };
  if (!idiomsAvailable(env)) return { record: current, started: false };

  await env.DB.prepare(
    `INSERT INTO idioms (hanzi, status, attempts, generator_version, started_at, updated_at)
       VALUES (?, 'generating', 0, ?, datetime('now'), datetime('now'))
     ON CONFLICT(hanzi) DO UPDATE SET status = 'generating', error = NULL, suggestion = NULL,
       generator_version = excluded.generator_version, started_at = datetime('now'), updated_at = datetime('now')`,
  )
    .bind(hanzi, IDIOM_GENERATOR_VERSION)
    .run();

  if (env.IDIOM_QUEUE && env.E2E_TEST_MODE !== 'true') {
    await env.IDIOM_QUEUE.send({ hanzi });
  } else {
    const run = runIdiomJob(env, hanzi).then((o) => console.log('[idioms] generated (inline)', hanzi, o));
    if (opts.waitUntil) opts.waitUntil(run);
    else await run;
  }
  return { record: await getIdiom(env.DB, hanzi), started: true };
}

export type IdiomJobOutcome = 'ready' | 'not_idiom' | 'failed' | 'skipped';

/** The queue job: one structured call, the row written ready / not_idiom / failed. */
export async function runIdiomJob(env: IdiomEnv, hanzi: string, deps: { client?: Pick<Anthropic, 'messages'>; sleep?: (ms: number) => Promise<void> } = {}): Promise<IdiomJobOutcome> {
  const row = await env.DB.prepare('SELECT status FROM idioms WHERE hanzi = ?').bind(hanzi).first<{ status: string }>();
  if (!row || row.status !== 'generating') return 'skipped';
  await env.DB.prepare(`UPDATE idioms SET attempts = attempts + 1, started_at = datetime('now') WHERE hanzi = ?`).bind(hanzi).run();

  const client = deps.client ?? (env.E2E_TEST_MODE === 'true' ? fakeIdiomClient() : undefined);
  try {
    if (!env.ANTHROPIC_API_KEY && !client) throw new StructuredCallError('AI is not configured', false);
    const result = await generateIdiomEntry({ apiKey: env.ANTHROPIC_API_KEY ?? '', hanzi, client, sleep: deps.sleep });
    if (result.kind === 'idiom') {
      await env.DB.prepare(
        `UPDATE idioms SET status = 'ready', entry = ?, error = NULL, suggestion = NULL, generator_version = ?, updated_at = datetime('now') WHERE hanzi = ?`,
      )
        .bind(JSON.stringify(result.entry), IDIOM_GENERATOR_VERSION, hanzi)
        .run();
      return 'ready';
    }
    await env.DB.prepare(`UPDATE idioms SET status = 'not_idiom', entry = NULL, error = ?, suggestion = ?, updated_at = datetime('now') WHERE hanzi = ?`)
      .bind(result.reason, result.suggestion, hanzi)
      .run();
    return 'not_idiom';
  } catch (error) {
    console.error('[idioms] generation failed:', hanzi, error instanceof Error ? error.message : error);
    const message = error instanceof StructuredCallError && !error.retryable
      ? 'Claude couldn’t write this one.'
      : 'Claude is busy right now — try again in a moment.';
    await env.DB.prepare(`UPDATE idioms SET status = 'failed', error = ?, updated_at = datetime('now') WHERE hanzi = ?`).bind(message, hanzi).run();
    return 'failed';
  }
}

/** Admin: queue up to `limit` starter idioms that have no entry yet (or failed). */
export async function backfillStarterIdioms(env: IdiomEnv, opts: { limit?: number; waitUntil?: (p: Promise<unknown>) => void } = {}): Promise<{ queued: string[]; remaining: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), STARTER_IDIOMS.length);
  const rows = await env.DB.prepare(`SELECT hanzi, status FROM idioms`).all<{ hanzi: string; status: string }>();
  const status = new Map((rows.results ?? []).map((r) => [r.hanzi, r.status]));
  const todo = STARTER_IDIOMS.filter((s) => !status.has(s.hanzi) || status.get(s.hanzi) === 'failed').map((s) => s.hanzi);
  const queued: string[] = [];
  for (const hanzi of todo.slice(0, limit)) {
    const { started } = await requestIdiom(env, hanzi, { waitUntil: opts.waitUntil });
    if (started) queued.push(hanzi);
  }
  return { queued, remaining: todo.length - queued.length };
}
