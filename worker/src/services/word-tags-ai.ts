/**
 * Word tags — the AI pass (shared/cards/word-tags-ai.ts; docs/STUDY_SESSION.md "Word tags").
 * A cheap batched Haiku call through structuredCall (forced `tag_words` tool, thinking off,
 * WORD_TAGS_BATCH_SIZE words per call) gives each note a transitivity and a register verdict and
 * says whether it is everyday spoken Mandarin ("Everyday speech", v2) — what the shipped lexicon
 * and the written-text frequency list can't say — stored as `notes.word_tags` with `word_tags_at`, which
 * /api/sync/changes follows (updated_at is never touched). The apps merge it under the lexicon's
 * tags (the lexicon always wins; low confidence is never shown; AI pills carry ✨).
 *
 * Runs on card-check-queue (`{ kind: 'word_tags' }`):
 * - a new / edited note (hanzi or English changed) — the content service's queueWordTags, at the
 *   same points as the word check and with its skips (`check: false`, copies, the starter deck)
 *   but NOT its account switch: tags are for every learner;
 * - the backfill of untagged notes: every /api/sync/changes calls maybeBackfillWordTags (at most
 *   WORD_TAGS_BACKFILL_PER_HOUR notes queued per user an hour, looked for at most every 15 min),
 *   and POST /api/notes/word-tags/backfill (+ the MCP `backfill_word_tags`) queues on demand.
 *   "Untagged" includes a verdict of an older WORD_TAGS_AI_VERSION (`v` in the JSON): bumping the
 *   version makes the same fill re-tag every note, never-tagged notes first, then newest first.
 *   The old verdict stays (and shows) until the new one replaces it.
 * A note the model gives nothing for is stored as `{ v: <version>, confidence: 'low' }` (done,
 * shows nothing); a failed call writes nothing, so the next hour's backfill tries again.
 * Token use is added up per user in `word_tag_runs` and reported as `server.word_tags_batch`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../types';
import { structuredCall } from './structured-call';
import { batchPrompt, modelAvailable, type CheckDeps, type CheckUsage } from './card-check';
import { fakeWordTagsClient } from './card-check-fake';
import { trackServer } from './analytics/server-events';
import { CHECK_MODEL, type CheckWord } from '@shared/cards/check';
import {
  AI_CONFIDENCES,
  AI_REGISTERS,
  AI_SPOKEN,
  REGISTER_NOTE_MAX,
  TRANSITIVITIES,
  WORD_TAGS_AI_VERSION,
  WORD_TAGS_BACKFILL_PER_HOUR,
  WORD_TAGS_BATCH_SIZE,
  isEverydaySpeech,
  pickAiWordTags,
  visibleAiWordTags,
  wordTagsCostUsd,
  type AiWordTags,
} from '@shared/cards/word-tags-ai';

export type WordTagsVia = 'create' | 'edit' | 'backfill';

export interface WordTagsMessage {
  kind: 'word_tags';
  userId: string;
  noteIds: string[];
  via?: WordTagsVia;
}

/** The model the tags run on (the word check's cheap model). */
export const WORD_TAGS_MODEL = CHECK_MODEL;

export const WORD_TAGS_SYSTEM = `You tag Chinese flashcards for a learner with three things a dictionary rarely says. Each card has hanzi, pinyin and an English gloss — judge the word in the sense the gloss gives.

Return one entry for EVERY card:
- index: the card's number.
- transitivity (for a single verb): "transitive" = takes a direct object right after it (告诉他, 喜欢音乐); "intransitive" = never takes a direct object — who / what it involves goes before the verb with 跟 / 对 / 给 (休息, 见面, 毕业, 道歉); "both" = natural with and without one (吃, 唱, 学习); "n/a" = not a verb, or a phrase / sentence that already has its object.
- separable: true only for a verb-object word whose halves split (睡觉 → 睡了一个好觉, 见面 → 见过面); omit otherwise.
- register: how the card sounds — "neutral" (most words), "formal" (official, written, speeches), "polite" (shows respect), "informal" (casual speech), "slang", "rude", "literary" (classical, bookish). For a sentence, judge the whole sentence.
- register_note: only when the register is not neutral and one hint helps the learner — at most ${REGISTER_NOTE_MAX} characters, e.g. "formal written; in speech use 告诉". Omit otherwise.
- confidence: "high", "medium" or "low" — how sure you are of the transitivity and register. Low verdicts are not shown, so say low rather than guess.
- spoken: "everyday" when a learner living in China would HEAR this word or phrase regularly in ordinary daily life — ordering and paying in restaurants (结账, 买单, 打包), shops, transport, at home, chatting with friends and family; otherwise "other". "Exists in speech" is not enough: bookish, technical, formal, regional, rare or old-fashioned words are "other", and so is any full sentence. Written-text frequency lists undercount everyday speech, so judge by daily conversation, not by how often the word is printed.
- spoken_confidence: only with "everyday" — "high", "medium" or "low". Only "high" is shown, so say high only when you are sure.
Be conservative: most words are neutral and most cards need no note.`;

const TAG_TOOL = {
  name: 'tag_words',
  description: 'Give every card of this batch its transitivity, register and everyday-speech verdict.',
  input_schema: {
    type: 'object' as const,
    properties: {
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            transitivity: { type: 'string', enum: [...TRANSITIVITIES] },
            separable: { type: 'boolean' },
            register: { type: 'string', enum: [...AI_REGISTERS] },
            register_note: { type: 'string' },
            confidence: { type: 'string', enum: [...AI_CONFIDENCES] },
            spoken: { type: 'string', enum: [...AI_SPOKEN] },
            spoken_confidence: { type: 'string', enum: [...AI_CONFIDENCES] },
          },
          required: ['index', 'transitivity', 'register', 'confidence', 'spoken'],
        },
      },
    },
    required: ['tags'],
  },
};

/** The tool's answer → verdicts by index in the batch (junk entries dropped). */
export function validateTagReply(input: unknown): Map<number, AiWordTags> {
  const tags = (input as { tags?: unknown })?.tags;
  if (!Array.isArray(tags)) throw new Error('tag_words: tags must be an array');
  const out = new Map<number, AiWordTags>();
  for (const t of tags) {
    if (!t || typeof t !== 'object') continue;
    const index = Number((t as { index?: unknown }).index);
    if (!Number.isInteger(index) || index < 0) continue;
    const { index: _i, ...rest } = t as Record<string, unknown>;
    const v = pickAiWordTags({ ...rest, v: WORD_TAGS_AI_VERSION });
    if (v) out.set(index, v);
  }
  return out;
}

/** The stand-in for a word the model said nothing about: done, shows nothing. */
export const EMPTY_VERDICT: AiWordTags = { v: WORD_TAGS_AI_VERSION, confidence: 'low' };

function modelClient(env: Env, deps: CheckDeps): Pick<Anthropic, 'messages'> | undefined {
  if (deps.client) return deps.client;
  if (env.E2E_TEST_MODE === 'true') return fakeWordTagsClient();
  return undefined;
}

/** One model call: verdicts by index into `batch`. Throws when the call fails. */
export async function tagBatch(env: Env, batch: CheckWord[], deps: CheckDeps = {}, usage?: CheckUsage): Promise<Map<number, AiWordTags>> {
  return structuredCall({
    apiKey: env.ANTHROPIC_API_KEY ?? 'test',
    model: WORD_TAGS_MODEL,
    fallbackModel: null,
    attempts: 2,
    system: WORD_TAGS_SYSTEM,
    user: batchPrompt(batch),
    tool: TAG_TOOL,
    maxTokens: 4000,
    validate: validateTagReply,
    client: modelClient(env, deps),
    sleep: deps.sleep,
    timeoutMs: 60_000,
    onUsage: (u) => {
      if (usage) {
        usage.input_tokens += u.input_tokens;
        usage.output_tokens += u.output_tokens;
      }
    },
  });
}

interface UntaggedRow extends CheckWord {
  id: string;
}

/**
 * SQL: the note `alias` needs (re-)tagging — no verdict, or one of an older WORD_TAGS_AI_VERSION
 * (a verdict without `v` counts as 1; unreadable JSON as outdated). Binds nothing.
 */
export function needsWordTagsSql(alias = 'n'): string {
  const col = alias ? `${alias}.word_tags` : 'word_tags';
  return `(CASE WHEN ${col} IS NULL THEN 1 WHEN json_valid(${col}) THEN COALESCE(json_extract(${col}, '$.v'), 1) < ${WORD_TAGS_AI_VERSION} ELSE 1 END)`;
}

/** The user's notes among `noteIds` that have no up-to-date tags yet. */
async function loadUntagged(db: D1Database, userId: string, noteIds: string[]): Promise<UntaggedRow[]> {
  const out: UntaggedRow[] = [];
  for (let i = 0; i < noteIds.length; i += 80) {
    const ids = noteIds.slice(i, i + 80);
    const res = await db
      .prepare(
        `SELECT n.id, n.hanzi, n.pinyin, n.english FROM notes n JOIN decks d ON d.id = n.deck_id
          WHERE d.user_id = ? AND ${needsWordTagsSql('n')} AND n.id IN (${ids.map(() => '?').join(',')})`
      )
      .bind(userId, ...ids)
      .all<UntaggedRow>();
    out.push(...(res.results ?? []));
  }
  return out;
}

async function addRunTotals(db: D1Database, userId: string, tagged: number, usage: CheckUsage): Promise<void> {
  await db
    .prepare(
      `INSERT INTO word_tag_runs (user_id, tagged, input_tokens, output_tokens, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET tagged = tagged + excluded.tagged, input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, updated_at = datetime('now')`
    )
    .bind(userId, tagged, usage.input_tokens, usage.output_tokens)
    .run();
}

export interface WordTagsRunResult {
  /** Notes given a verdict (incl. the empty one). */
  tagged: number;
  /** Notes whose verdict shows something (not low confidence). */
  shown: number;
  /** Notes the verdict calls Everyday speech (shown: high spoken confidence). */
  everyday: number;
  /** Notes left untagged because their batch's model call failed. */
  failed: number;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Tag the user's untagged notes among `noteIds`, a batch at a time. Idempotent: a note that
 * already has tags, was edited meanwhile, or isn't the user's is left alone.
 */
export async function runWordTags(env: Env, userId: string, noteIds: string[], deps: CheckDeps = {}, via: WordTagsVia = 'create'): Promise<WordTagsRunResult> {
  const result: WordTagsRunResult = { tagged: 0, shown: 0, everyday: 0, failed: 0, input_tokens: 0, output_tokens: 0 };
  if (!noteIds.length || !modelAvailable(env, deps)) return result;
  const notes = await loadUntagged(env.DB, userId, [...new Set(noteIds)]);
  for (let start = 0; start < notes.length; start += WORD_TAGS_BATCH_SIZE) {
    const batch = notes.slice(start, start + WORD_TAGS_BATCH_SIZE);
    const usage: CheckUsage = { input_tokens: 0, output_tokens: 0 };
    let verdicts: Map<number, AiWordTags>;
    try {
      verdicts = await tagBatch(env, batch, deps, usage);
    } catch (err) {
      console.warn('[word-tags] batch failed, left for the next backfill:', err instanceof Error ? err.message : err);
      result.failed += batch.length;
      if (usage.input_tokens || usage.output_tokens) await addRunTotals(env.DB, userId, 0, usage);
      continue;
    }
    let tagged = 0;
    let shown = 0;
    let everyday = 0;
    for (let i = 0; i < batch.length; i++) {
      const verdict = verdicts.get(i) ?? EMPTY_VERDICT;
      const n = batch[i];
      const res = await env.DB
        .prepare(
          `UPDATE notes SET word_tags = ?, word_tags_at = datetime('now')
            WHERE id = ? AND ${needsWordTagsSql('')} AND hanzi = ? AND english = ?`
        )
        .bind(JSON.stringify(verdict), n.id, n.hanzi, n.english)
        .run();
      if ((res.meta?.changes ?? 0) > 0) {
        tagged++;
        if (visibleAiWordTags(verdict) || isEverydaySpeech(verdict)) shown++;
        if (isEverydaySpeech(verdict)) everyday++;
      }
    }
    await addRunTotals(env.DB, userId, tagged, usage);
    result.tagged += tagged;
    result.shown += shown;
    result.everyday += everyday;
    result.input_tokens += usage.input_tokens;
    result.output_tokens += usage.output_tokens;
    void trackServer(
      'server.word_tags_batch',
      {
        batch_size: batch.length,
        tagged,
        shown,
        everyday,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: Math.round(wordTagsCostUsd(usage.input_tokens, usage.output_tokens) * 1e6) / 1e6,
        via,
      },
      { env, userId }
    );
  }
  return result;
}

/**
 * Queue the tagging of new / edited notes (every account; the content service skips copies,
 * the starter deck and `check: false`). Never throws: tags are a nicety, never a reason for a
 * save to fail.
 */
export async function queueWordTags(
  env: Env,
  userId: string,
  noteIds: string[],
  bg?: { waitUntil(p: Promise<unknown>): void },
  via: WordTagsVia = 'create'
): Promise<void> {
  if (!noteIds.length || !modelAvailable(env)) return;
  try {
    if (env.CARD_CHECK_QUEUE) {
      for (let i = 0; i < noteIds.length; i += WORD_TAGS_BATCH_SIZE) {
        await env.CARD_CHECK_QUEUE.send({ kind: 'word_tags', userId, noteIds: noteIds.slice(i, i + WORD_TAGS_BATCH_SIZE), via });
      }
      return;
    }
    const run = runWordTags(env, userId, noteIds, {}, via).then(() => undefined);
    if (bg) bg.waitUntil(run.catch((err) => console.error('[word-tags] tagging failed', err)));
    else await run;
  } catch (err) {
    console.error('[word-tags] could not queue tagging', err);
  }
}

/** A note's word or meaning changed: its tags are about the old one (the devices drop them on the next sync). */
export async function clearWordTags(db: D1Database, noteId: string): Promise<void> {
  await db.prepare(`UPDATE notes SET word_tags = NULL, word_tags_at = datetime('now') WHERE id = ? AND word_tags IS NOT NULL`).bind(noteId).run();
}

export interface WordTagsProgress {
  /** The user's notes. */
  total: number;
  /** Notes with an up-to-date verdict (WORD_TAGS_AI_VERSION). */
  tagged: number;
  /** Notes still to (re-)tag: never tagged + outdated. */
  untagged: number;
  /** Of `untagged`, notes with a verdict of an older version (re-tagged by the same fill). */
  outdated: number;
  /** Tokens and dollars the pass has used for this user so far. */
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Notes the sync's backfill queued this hour (≤ WORD_TAGS_BACKFILL_PER_HOUR). */
  queued_this_hour: number;
  per_hour: number;
}

interface RunRow {
  window_count: number;
  in_window: number;
  recent: number;
  input_tokens: number;
  output_tokens: number;
}

async function readRun(db: D1Database, userId: string): Promise<RunRow | null> {
  return db
    .prepare(
      `SELECT window_count, input_tokens, output_tokens,
              (window_start IS NOT NULL AND window_start > datetime('now', '-1 hour')) AS in_window,
              (checked_at IS NOT NULL AND checked_at > datetime('now', '-15 minutes')) AS recent
         FROM word_tag_runs WHERE user_id = ?`
    )
    .bind(userId)
    .first<RunRow>();
}

export async function wordTagsProgress(db: D1Database, userId: string): Promise<WordTagsProgress> {
  const counts = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN ${needsWordTagsSql('n')} THEN 0 ELSE 1 END), 0) AS tagged,
              COALESCE(SUM(CASE WHEN n.word_tags IS NOT NULL AND ${needsWordTagsSql('n')} THEN 1 ELSE 0 END), 0) AS outdated
         FROM notes n JOIN decks d ON d.id = n.deck_id WHERE d.user_id = ?`
    )
    .bind(userId)
    .first<{ total: number; tagged: number; outdated: number }>();
  const run = await readRun(db, userId);
  const total = counts?.total ?? 0;
  const tagged = counts?.tagged ?? 0;
  const input = run?.input_tokens ?? 0;
  const output = run?.output_tokens ?? 0;
  return {
    total,
    tagged,
    untagged: total - tagged,
    outdated: counts?.outdated ?? 0,
    input_tokens: input,
    output_tokens: output,
    cost_usd: Math.round(wordTagsCostUsd(input, output) * 10_000) / 10_000,
    queued_this_hour: run && run.in_window ? run.window_count : 0,
    per_hour: WORD_TAGS_BACKFILL_PER_HOUR,
  };
}

/** Notes to (re-)tag: never-tagged ones first (they show nothing yet), then outdated; newest first. */
async function untaggedIds(db: D1Database, userId: string, limit: number): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT n.id FROM notes n JOIN decks d ON d.id = n.deck_id
        WHERE d.user_id = ? AND ${needsWordTagsSql('n')}
        ORDER BY (n.word_tags IS NULL) DESC, n.created_at DESC, n.id LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ id: string }>();
  return (res.results ?? []).map((r) => r.id);
}

async function recordQueued(db: D1Database, userId: string, queued: number, inWindow: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO word_tag_runs (user_id, window_start, window_count, checked_at, updated_at) VALUES (?, datetime('now'), ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         window_start = CASE WHEN ? THEN window_start ELSE datetime('now') END,
         window_count = CASE WHEN ? THEN window_count + excluded.window_count ELSE excluded.window_count END,
         checked_at = datetime('now'), updated_at = datetime('now')`
    )
    .bind(userId, queued, inWindow ? 1 : 0, inWindow ? 1 : 0)
    .run();
}

/**
 * The sync's background backfill: queue up to this hour's remaining allowance of the user's
 * untagged notes (newest first). Looks at most every 15 minutes. Returns how many were queued
 * (0 when there was nothing to do or no room).
 */
export async function maybeBackfillWordTags(env: Env, userId: string, bg?: { waitUntil(p: Promise<unknown>): void }): Promise<number> {
  if (!modelAvailable(env)) return 0;
  const run = await readRun(env.DB, userId);
  if (run?.recent) return 0;
  const inWindow = !!run?.in_window;
  const room = WORD_TAGS_BACKFILL_PER_HOUR - (inWindow ? run!.window_count : 0);
  const ids = room > 0 ? await untaggedIds(env.DB, userId, room) : [];
  await recordQueued(env.DB, userId, ids.length, inWindow);
  if (!ids.length) return 0;
  await queueWordTags(env, userId, ids, bg, 'backfill');
  void trackServer('server.word_tags_backfill', { queued: ids.length, via: 'sync' }, { env, userId });
  return ids.length;
}

export const BACKFILL_MAX = 1000;

/**
 * POST /api/notes/word-tags/backfill (and the MCP tool): queue up to `limit` untagged notes
 * now, whatever this hour's allowance (it counts towards it). Returns what was queued + progress.
 */
export async function backfillWordTagsNow(
  env: Env,
  userId: string,
  limit: number,
  bg?: { waitUntil(p: Promise<unknown>): void }
): Promise<WordTagsProgress & { queued: number }> {
  const n = Math.max(1, Math.min(BACKFILL_MAX, Math.floor(limit) || WORD_TAGS_BACKFILL_PER_HOUR));
  const run = await readRun(env.DB, userId);
  const ids = await untaggedIds(env.DB, userId, n);
  await recordQueued(env.DB, userId, ids.length, !!run?.in_window);
  if (ids.length) {
    await queueWordTags(env, userId, ids, bg, 'backfill');
    void trackServer('server.word_tags_backfill', { queued: ids.length, via: 'api' }, { env, userId });
  }
  return { queued: ids.length, ...(await wordTagsProgress(env.DB, userId)) };
}
