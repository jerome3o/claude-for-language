/**
 * 梗 Meme review (PROTOTYPE, docs/MEME_REVIEW.md): the monthly issue's row and its job.
 *
 * ONE row per calendar month in `meme_issues` (shared by every account). A generation runs on
 * `meme-review-queue` in two resumable phases:
 *   research   — the agent (agent.ts) until `submit_issue` is accepted; its state is checkpointed
 *                in R2 (`meme-review/agent/<month>.json`) after every turn;
 *   illustrate — one Gemini picture per meme (images.ts), the issue saved after each.
 * A delivery that passes its deadline re-enqueues itself; the row's counters (rounds, searches,
 * tokens, estimated cost) are kept up to date. Who may start one: the admin route, the MCP
 * admin tool and the cron (the 1st of each month, `ensureMonthlyMemeIssue`).
 */
import {
  MEME_REVIEW_VERSION,
  coverageWindow,
  isMemeMonth,
  memeMonthLabel,
  memeMonthOf,
  parseStoredMemeIssue,
  type MemeIssue,
  type MemeIssueRecord,
  type MemeIssueStatus,
  type MemeIssueSummary,
} from '@shared/meme-review';
import type { Env } from '../../types';
import { pinyinLine } from '../podcasts/segments';
import { trackServer } from '../analytics/server-events';
import {
  anthropicMemeCall,
  memeBriefing,
  memeCostUsd,
  newMemeAgentState,
  runMemeAgent,
  type MemeAgentState,
  type MemeModelCall,
} from './agent';
import { drawMemePicture } from './images';
import { fakeMemeCall } from './fake';

export interface MemeReviewQueueMessage {
  month?: string;
  /** "Make a mini lesson" jobs ride the same queue (lesson.ts). */
  kind?: 'lesson';
  jobId?: string;
}

export type MemeEnv = Pick<Env, 'DB' | 'AUDIO_BUCKET' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' | 'E2E_TEST_MODE'> & Partial<Pick<Env, 'MEME_REVIEW_QUEUE'>>;

/** A delivery's working time before it checkpoints and re-enqueues (queue consumers get 15 min). */
export const MEME_DELIVERY_MS = 6 * 60_000;
/** A generating row not touched for this long is reported failed (Retry shows). */
export const MEME_STALE_MINUTES = 30;
/** Deliveries before a generation gives up. */
export const MEME_MAX_ATTEMPTS = 10;

/** The fake model stands in under E2E_TEST_MODE and when no key is set (dev). */
export function memeUsesFake(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'>): boolean {
  return env.E2E_TEST_MODE === 'true' || !env.ANTHROPIC_API_KEY;
}

export const agentKey = (month: string) => `meme-review/agent/${month}.json`;

interface MemeRow {
  month: string;
  status: string;
  phase: string;
  issue: string | null;
  progress: string | null;
  error: string | null;
  agent_key: string | null;
  attempts: number;
  rounds: number;
  searches: number;
  fetches: number;
  images: number;
  cost_usd: number;
  updated_at: string | null;
}

function parseIssue(json: string | null): MemeIssue | null {
  if (!json) return null;
  try {
    return parseStoredMemeIssue(JSON.parse(json));
  } catch {
    return null;
  }
}

export function rowToRecord(row: MemeRow | null, month: string): MemeIssueRecord {
  if (!row) return { month, status: 'missing', issue: null, progress: null, error: null, updated_at: null };
  const issue = row.status === 'ready' ? parseIssue(row.issue) : null;
  const status = (row.status === 'ready' && !issue ? 'failed' : row.status) as MemeIssueStatus;
  return {
    month: row.month,
    status,
    issue,
    progress: status === 'generating' ? row.progress : null,
    error: status === 'failed' ? row.error || 'Something went wrong writing this issue.' : null,
    updated_at: row.updated_at,
  };
}

async function sweepStale(db: D1Database, month?: string): Promise<void> {
  await db
    .prepare(
      `UPDATE meme_issues SET status = 'failed', error = 'Writing this issue stopped — try again.', updated_at = datetime('now')
        WHERE status = 'generating' AND updated_at < datetime('now', '-${MEME_STALE_MINUTES} minutes')${month ? ' AND month = ?' : ''}`,
    )
    .bind(...(month ? [month] : []))
    .run();
}

async function loadRow(db: D1Database, month: string): Promise<MemeRow | null> {
  return db.prepare('SELECT * FROM meme_issues WHERE month = ?').bind(month).first<MemeRow>();
}

export async function getMemeIssue(db: D1Database, month: string): Promise<MemeIssueRecord> {
  await sweepStale(db, month);
  return rowToRecord(await loadRow(db, month), month);
}

/** Every issue, newest month first (the list). */
export async function listMemeIssues(db: D1Database, limit = 24): Promise<MemeIssueSummary[]> {
  await sweepStale(db);
  const rows = await db
    .prepare(`SELECT month, status, issue, updated_at FROM meme_issues ORDER BY month DESC LIMIT ?`)
    .bind(Math.min(Math.max(limit, 1), 60))
    .all<{ month: string; status: string; issue: string | null; updated_at: string | null }>();
  return (rows.results ?? []).map((r) => {
    const issue = r.status === 'ready' ? parseIssue(r.issue) : null;
    return {
      month: r.month,
      status: (r.status === 'ready' && !issue ? 'failed' : r.status) as MemeIssueStatus,
      title: issue?.title ?? null,
      title_en: issue?.title_en ?? null,
      item_count: issue?.items.length ?? 0,
      preview: issue ? issue.items.slice(0, 4).map((i) => i.hanzi) : [],
      updated_at: r.updated_at,
    };
  });
}

/** The memes earlier issues covered (so a new issue doesn't repeat them). */
async function earlierHanzi(db: D1Database, month: string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT issue FROM meme_issues WHERE status = 'ready' AND month < ? ORDER BY month DESC LIMIT 6`)
    .bind(month)
    .all<{ issue: string | null }>();
  return (rows.results ?? []).flatMap((r) => parseIssue(r.issue)?.items.map((i) => i.hanzi) ?? []);
}

// ---------- Request ----------

export type MemeRequestVia = 'cron' | 'admin' | 'mcp';

/**
 * Start (or keep) the month's generation. A ready issue is kept unless `regenerate`; a generating
 * one is kept; missing / failed start. Without the queue binding (tests, E2E) the job runs inline
 * (in waitUntil when given).
 */
export async function requestMemeIssue(
  env: MemeEnv,
  month: string,
  opts: { via: MemeRequestVia; regenerate?: boolean; waitUntil?: (p: Promise<unknown>) => void },
): Promise<{ record: MemeIssueRecord; started: boolean }> {
  if (!isMemeMonth(month)) throw new Error(`Not a month: ${month}`);
  const current = await getMemeIssue(env.DB, month);
  if (current.status === 'generating' || (current.status === 'ready' && !opts.regenerate)) return { record: current, started: false };

  await env.AUDIO_BUCKET.delete(agentKey(month)).catch(() => undefined);
  await env.DB.prepare(
    `INSERT INTO meme_issues (month, status, phase, progress, requested_via, generator_version, started_at, updated_at)
       VALUES (?, 'generating', 'research', 'Starting…', ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(month) DO UPDATE SET status = 'generating', phase = 'research', issue = NULL, error = NULL, progress = 'Starting…',
       agent_key = NULL, requested_via = excluded.requested_via, attempts = 0, rounds = 0, searches = 0, fetches = 0,
       input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0, images = 0, cost_usd = 0,
       generator_version = excluded.generator_version, started_at = datetime('now'), updated_at = datetime('now')`,
  )
    .bind(month, opts.via, MEME_REVIEW_VERSION)
    .run();
  void trackServer('meme_review.generate', { via: opts.via, regenerate: !!opts.regenerate }, { env: env as Env, userId: null });

  if (env.MEME_REVIEW_QUEUE && env.E2E_TEST_MODE !== 'true') {
    await env.MEME_REVIEW_QUEUE.send({ month });
  } else {
    const run = runMemeIssueUntilSettled(env, month).then((o) => console.log('[meme-review] generated (inline)', month, o));
    if (opts.waitUntil) opts.waitUntil(run);
    else await run;
  }
  return { record: await getMemeIssue(env.DB, month), started: true };
}

/** The cron (daily 03:17 UTC): on the 1st–2nd of a month, start that month's issue if it has none. */
export async function ensureMonthlyMemeIssue(env: MemeEnv, nowMs: number): Promise<'started' | 'exists' | 'not_today'> {
  const day = new Date(nowMs).getUTCDate();
  if (day > 2) return 'not_today';
  const month = memeMonthOf(nowMs);
  const row = await loadRow(env.DB, month);
  if (row) return 'exists';
  await requestMemeIssue(env, month, { via: 'cron' });
  return 'started';
}

// ---------- The job ----------

export type MemeJobOutcome = 'ready' | 'continue' | 'failed' | 'skipped';

interface Deps {
  call?: MemeModelCall;
  /** Gemini stand-in (tests). */
  draw?: typeof drawMemePicture;
  now?: () => number;
  deliveryMs?: number;
  today?: string;
}

const derivePinyin = (text: string) => pinyinLine(text);

async function loadState(env: MemeEnv, month: string): Promise<MemeAgentState | null> {
  const obj = await env.AUDIO_BUCKET.get(agentKey(month));
  if (!obj) return null;
  try {
    return (await obj.json()) as MemeAgentState;
  } catch {
    return null;
  }
}

async function saveState(env: MemeEnv, month: string, state: MemeAgentState, progress: string, images: number): Promise<void> {
  await env.AUDIO_BUCKET.put(agentKey(month), JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(
    `UPDATE meme_issues SET agent_key = ?, progress = ?, rounds = ?, searches = ?, fetches = ?, input_tokens = ?, output_tokens = ?,
       cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?, updated_at = datetime('now') WHERE month = ?`,
  )
    .bind(
      agentKey(month), progress, state.rounds, state.searches, state.fetches,
      state.usage.input_tokens, state.usage.output_tokens, state.usage.cache_read_input_tokens, state.usage.cache_creation_input_tokens,
      memeCostUsd(state.usage, state.searches, images), month,
    )
    .run();
}

async function fail(env: MemeEnv, month: string, reason: string): Promise<MemeJobOutcome> {
  console.error('[meme-review] failed:', month, reason);
  await env.DB.prepare(`UPDATE meme_issues SET status = 'failed', error = ?, progress = NULL, updated_at = datetime('now') WHERE month = ?`).bind(reason, month).run();
  return 'failed';
}

/** One delivery: research and/or illustrate until done or the deadline. */
export async function runMemeIssueJob(env: MemeEnv, month: string, deps: Deps = {}): Promise<MemeJobOutcome> {
  const row = await loadRow(env.DB, month);
  if (!row || row.status !== 'generating') return 'skipped';
  if (row.attempts >= MEME_MAX_ATTEMPTS) return fail(env, month, 'Writing this issue took too many tries — try again.');
  await env.DB.prepare(`UPDATE meme_issues SET attempts = attempts + 1, updated_at = datetime('now') WHERE month = ?`).bind(month).run();

  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deliveryMs ?? MEME_DELIVERY_MS);
  const today = deps.today ?? new Date(now()).toISOString().slice(0, 10);
  let images = row.images;

  try {
    let issue = parseIssue(row.issue);
    if (row.phase !== 'illustrate' || !issue) {
      const covers = coverageWindow(today);
      const state = (await loadState(env, month)) ?? newMemeAgentState(memeBriefing({ month, monthLabel: memeMonthLabel(month), covers, today, earlier: await earlierHanzi(env.DB, month) }));
      const call = deps.call ?? (memeUsesFake(env) ? fakeMemeCall() : anthropicMemeCall(env.ANTHROPIC_API_KEY));
      const outcome = await runMemeAgent({
        month,
        covers,
        state,
        call,
        derivePinyin,
        deadline,
        now,
        checkpoint: (s, progress) => saveState(env, month, s, progress, images),
      });
      if (outcome.kind === 'failed') return fail(env, month, outcome.reason);
      if (outcome.kind === 'continue') return 'continue';
      issue = outcome.issue;
      if (outcome.notes.length) console.log('[meme-review] accepted with notes:', month, outcome.notes.slice(0, 10));
      await env.DB.prepare(`UPDATE meme_issues SET phase = 'illustrate', issue = ?, progress = 'Drawing the pictures…', updated_at = datetime('now') WHERE month = ?`)
        .bind(JSON.stringify(issue), month)
        .run();
    }

    // Illustrate: one picture per meme still without one (a failed picture is left out, not retried forever).
    const draw = deps.draw ?? drawMemePicture;
    const canDraw = !!env.GEMINI_API_KEY && env.E2E_TEST_MODE !== 'true';
    const state = await loadState(env, month);
    const tried = new Set(state?.pictures_tried ?? []);
    for (const item of issue.items) {
      if (!canDraw && !deps.draw) break;
      if (item.picture.image_key || tried.has(item.id)) continue;
      if (now() > deadline) return 'continue';
      tried.add(item.id);
      const key = await draw({ apiKey: env.GEMINI_API_KEY ?? '', prompt: item.picture.prompt, month, itemId: item.id, bucket: env.AUDIO_BUCKET });
      if (key) {
        item.picture.image_key = key;
        images += 1;
      }
      if (state) await env.AUDIO_BUCKET.put(agentKey(month), JSON.stringify({ ...state, pictures_tried: [...tried] })).catch(() => undefined);
      const cost = state ? memeCostUsd(state.usage, state.searches, images) : 0;
      await env.DB.prepare(`UPDATE meme_issues SET issue = ?, images = ?, cost_usd = ?, progress = ?, updated_at = datetime('now') WHERE month = ?`)
        .bind(JSON.stringify(issue), images, cost, `Drawing the pictures… (${tried.size}/${issue.items.length})`, month)
        .run();
    }

    await env.DB.prepare(`UPDATE meme_issues SET status = 'ready', issue = ?, progress = NULL, error = NULL, updated_at = datetime('now') WHERE month = ?`)
      .bind(JSON.stringify(issue), month)
      .run();
    const done = await env.DB.prepare('SELECT rounds, searches, images, cost_usd FROM meme_issues WHERE month = ?').bind(month).first<{ rounds: number; searches: number; images: number; cost_usd: number }>();
    console.log(JSON.stringify({ type: 'meme_review', month, status: 'ready', items: issue.items.length, ...done }));
    void trackServer('meme_review.ready', { items: issue.items.length, searches: done?.searches ?? 0, images: done?.images ?? 0 }, { env: env as Env, userId: null });
    return 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[meme-review] delivery crashed:', month, message);
    // A busy / failing model: the next delivery resumes from the checkpoint (attempts are capped).
    return 'continue';
  }
}

/** Inline mode (tests, E2E, no queue): deliveries back to back until the job settles. */
export async function runMemeIssueUntilSettled(env: MemeEnv, month: string, deps: Deps = {}): Promise<MemeJobOutcome> {
  for (let i = 0; i < MEME_MAX_ATTEMPTS + 1; i++) {
    const outcome = await runMemeIssueJob(env, month, deps);
    if (outcome !== 'continue') return outcome;
  }
  return fail(env, month, 'Writing this issue took too many tries — try again.');
}

/** Queue consumer: a delivery; 'continue' re-enqueues (a short delay, so a busy model can breathe). */
export async function handleMemeIssueMessage(env: MemeEnv, month: string): Promise<MemeJobOutcome> {
  const outcome = await runMemeIssueJob(env, month);
  if (outcome === 'continue') {
    if (env.MEME_REVIEW_QUEUE) await env.MEME_REVIEW_QUEUE.send({ month }, { delaySeconds: 5 });
    else return runMemeIssueUntilSettled(env, month);
  }
  return outcome;
}

/** The admin's view of a row (cost, counters) — GET /api/meme-review/:month?admin=1. */
export async function memeIssueStats(db: D1Database, month: string): Promise<Record<string, unknown> | null> {
  return db
    .prepare('SELECT month, status, phase, attempts, rounds, searches, fetches, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, images, cost_usd, requested_via, started_at, updated_at FROM meme_issues WHERE month = ?')
    .bind(month)
    .first<Record<string, unknown>>();
}
