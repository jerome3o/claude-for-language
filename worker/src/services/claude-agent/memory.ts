/**
 * Claude memory (docs/CHAT.md "Claude threads" → "Memory"; the unified-Claude-chats plan §4): the SAME
 * Claude in every chat, able to remember the learner's earlier chats without reading them all into every
 * prompt. Four layers, each with a hard budget:
 *
 *   thread summary   ≤ ~80 words + "Topics: …" per thread (coach_conversations.summary), rewritten after a
 *                    reply when ≥ 2 messages are new since `summary_upto` — a cheap background call
 *                    (`MODEL_POLICY.summary`, `structuredCall`), never in the reply's way.
 *   learner digest   ≤ ~600 tokens of notes (working on / keeps confusing / interests / level) + an index of
 *                    the ≤ 20 most recent chats (claude_learner_memory) — rebuilt by the daily cron and after
 *                    5 new summaries (the first one: after the first summary). In EVERY turn's learner block
 *                    (cached: it changes a few times a day at most), ≤ 800 tokens (`memoryBlock`).
 *   tools            search_my_chats (≤ 1.5k tokens) / read_chat (≤ 3k tokens): look things up on demand,
 *                    the learner's own threads only (tools/memory.ts).
 *   compaction       a thread over ~12k tokens of history sends its first message (the context's framing),
 *                    its summary and the last few turns instead of everything (`compactMessages`).
 *
 * E2E_TEST_MODE: a deterministic stand-in writes the summaries and the digest (checked first — CLAUDE.md
 * "E2E is hermetic"). Costs flow through the ai-usage fetch wrapper like every model call; each call also
 * records `server.claude_memory` and adds its tokens to the learner's row.
 *
 * PRIVACY: only the learner's own chats with Claude go in — never `student_profiles` (the tutor's private
 * note), never another person's data (__tests__/privacy.test.ts).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { contextBadge, parseIntent, parseStoredContext } from '@shared/claude/context';
import { parseCardToolResults } from '@shared/claude/cardTools';
import type { Env } from '../../types';
import { currentScope } from '../analytics/scope';
import { trackServer } from '../analytics/server-events';
import { structuredCall } from '../structured-call';
import { MODEL_POLICY } from './model';
import * as store from './store';
import { toolRecordLine } from './tool-record';

// ---------- Budgets ----------

/** A summary is rewritten once at least this many messages are new since the last one. */
export const SUMMARY_MIN_NEW_MESSAGES = 2;
/** ≈ 80 words (+ the topics line). */
export const SUMMARY_MAX_CHARS = 700;
/** The new messages a summary call reads (the newest kept), and each one's share. */
export const SUMMARY_INPUT_MAX_CHARS = 8000;
export const SUMMARY_MESSAGE_MAX_CHARS = 700;
/** The digest is rebuilt after this many new thread summaries (and by the daily cron). */
export const DIGEST_REBUILD_AFTER = 5;
/** The digest's own cap, and the summaries it is written from. */
export const DIGEST_MAX_TOKENS = 600;
export const DIGEST_SOURCE_THREADS = 30;
/** The recent-chats index. */
export const THREADS_INDEX_MAX = 20;
/** The memory block in every prompt: digest + index; the digest's share of it. */
export const MEMORY_BLOCK_MAX_TOKENS = 800;
export const MEMORY_DIGEST_SHARE = 500;
/** A thread's history above this is compacted: first message + summary + the last turns. */
export const HISTORY_TOKEN_BUDGET = 12_000;
export const HISTORY_KEEP_TURNS = 6;
/** The daily cron: threads active in the last 30 days, at most so many calls a run. */
export const CRON_SUMMARY_DAYS = 30;
export const CRON_MAX_SUMMARIES = 60;
export const CRON_MAX_DIGESTS = 30;

// ---------- Token estimates ----------

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/g;

/**
 * A conservative token estimate without a tokenizer: about one token per Han character / full-width
 * mark and one per three other characters. CJK-heavy text lands well above `chars / 2`, English near
 * the real count — budgets built on it err on the small side.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 3);
}

/** `text` cut to about `maxTokens` (on a character boundary, … appended). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let cost = 0;
  let i = 0;
  const chars = Array.from(text);
  for (; i < chars.length; i++) {
    cost += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(chars[i]) ? 1 : 1 / 3;
    if (cost > maxTokens - 1) break;
  }
  return `${chars.slice(0, i).join('').trimEnd()}…`;
}

/** `text` on one line, cut to `max` characters. */
export function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ---------- Badges / message text ----------

/** "📇 Asked on card · 银行", "✏️ Check", or "Chat" — what the thread is, for the model. */
export function badgeText(row: { context_kind: string | null; context_json: string | null; action?: string | null }): string {
  const ctx = parseStoredContext(row.context_kind, row.context_json);
  const badge = contextBadge(ctx, parseIntent(row.action));
  return badge ? `${badge.icon} ${badge.text}` : 'Chat';
}

/** A stored message as plain text for the memory (an analysis / mini lesson described, not dumped). */
export function memoryMessageText(m: { content_type: string; content: string; role?: string; tool_results?: string | null }, max: number): string {
  if (m.content_type === 'mistake_lesson') return '(made a mini lesson on the mistake)';
  if (m.content_type === 'analysis') {
    let body = m.content;
    try {
      const v = JSON.parse(m.content) as Record<string, unknown>;
      body = JSON.stringify(v).replace(/["{}[\]]/g, ' ');
    } catch {
      // keep as is
    }
    return `(Sentence Coach analysis) ${oneLine(body, Math.min(300, max))}`;
  }
  const text = m.content.length > max ? `${m.content.slice(0, max - 1).trimEnd()}…` : m.content;
  // What Claude's tools did in that reply (tool-record.ts): a summary / read_chat never says a card wasn't made.
  const done = m.role === 'assistant' ? parseCardToolResults(m.tool_results).map(toolRecordLine) : [];
  return done.length ? `${text}\n(Tools: ${done.join(' ')})` : text;
}

const speaker = (role: string) => (role === 'user' ? 'Learner' : 'Claude');
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

// ---------- The model (structuredCall; the E2E stand-in first) ----------

export type MemoryEnv = Pick<Env, 'DB' | 'ANTHROPIC_API_KEY' | 'E2E_TEST_MODE'> & Partial<Env>;

export interface MemoryDeps {
  /** The model (tests). null = no memory calls. Default: the stand-in in E2E_TEST_MODE, else the real model. */
  client?: Pick<Anthropic, 'messages'> | null;
  /** Retry back-off (tests). */
  sleep?: (ms: number) => Promise<void>;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
}

type CallResult<T> = { value: T; usage: Usage } | null;

async function memoryCall<T>(
  env: MemoryEnv,
  deps: MemoryDeps,
  policy: 'summary' | 'digest',
  spec: { system: string; user: string; tool: { name: string; description: string; input_schema: Anthropic.Tool.InputSchema }; validate: (v: unknown) => T },
  fake: () => T,
): Promise<CallResult<T>> {
  if (env.E2E_TEST_MODE === 'true') return { value: fake(), usage: { input_tokens: 0, output_tokens: 0 } };
  if (deps.client === null) return null;
  if (!deps.client && !env.ANTHROPIC_API_KEY) return null;
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const value = await structuredCall<T>({
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    model: MODEL_POLICY[policy].model,
    // Already the small model: no fallback.
    fallbackModel: null,
    system: spec.system,
    user: spec.user,
    tool: spec.tool,
    maxTokens: MODEL_POLICY[policy].maxTokens,
    validate: spec.validate,
    attempts: 2,
    timeoutMs: 30_000,
    onUsage: (u) => {
      usage.input_tokens += u.input_tokens;
      usage.output_tokens += u.output_tokens;
    },
    ...(deps.client ? { client: deps.client } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  return { value, usage };
}

async function recordMemoryCall(env: MemoryEnv, userId: string, kind: 'summary' | 'digest', usage: Usage, started: number): Promise<void> {
  await store.addMemoryTokens(env.DB, userId, usage.input_tokens, usage.output_tokens).catch(() => undefined);
  void trackServer('server.claude_memory', { kind, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, ms: Date.now() - started }, { env: env as Env, userId });
}

// ---------- Thread summaries ----------

export const SUMMARY_TOOL = {
  name: 'write_chat_summary',
  description: 'Save the updated summary of this chat.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'At most 80 words, English, plain text.' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Up to 8 short topics: Chinese words in hanzi, grammar points ("把 sentences"), situations.' },
    },
    required: ['summary', 'topics'],
  },
};

export const SUMMARY_SYSTEM = `You keep short notes on a Chinese learner's chats with Claude (an AI tutor in their flashcard app), for Claude to read in later chats with the same learner.

Update the running summary of ONE chat with its new messages. At most 80 words, English, plain text: what the learner asked about or practised, the Chinese words and grammar points discussed (write them in hanzi), what they struggled with or got wrong, and anything left open. Facts only — no greetings, no advice, no long quotes. Keep what still matters from the summary so far.`;

export interface ThreadSummaryValue {
  summary: string;
  topics: string[];
}

export function validateThreadSummary(v: unknown): ThreadSummaryValue {
  const o = (v ?? {}) as { summary?: unknown; topics?: unknown };
  const summary = typeof o.summary === 'string' ? o.summary.replace(/\s+\n/g, '\n').trim() : '';
  if (!summary) throw new Error('summary missing');
  const topics = Array.isArray(o.topics)
    ? o.topics.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => oneLine(t, 30)).slice(0, 8)
    : [];
  return { summary, topics };
}

/** The stored summary: the text, then "Topics: …", within SUMMARY_MAX_CHARS. */
export function storedSummary(v: ThreadSummaryValue): string {
  const topics = v.topics.length ? `\nTopics: ${v.topics.join(', ')}` : '';
  const room = SUMMARY_MAX_CHARS - topics.length;
  const text = v.summary.length > room ? `${v.summary.slice(0, room - 1).trimEnd()}…` : v.summary;
  return `${text}${topics}`;
}

/** The E2E stand-in: what the learner said first, the number of messages, the Chinese words. */
export function fakeThreadSummary(previous: string | null, messages: Array<{ role: string; content: string }>): ThreadSummaryValue {
  const first = messages.find((m) => m.role === 'user')?.content ?? '';
  const words = Array.from(new Set(messages.flatMap((m) => m.content.match(/[一-鿿]{2,4}/g) ?? []))).slice(0, 5);
  const base = previous ? previous.split('\nTopics:')[0] : '(E2E) The learner talked with Claude.';
  return { summary: `${base} ${messages.length} more messages, starting: “${oneLine(first, 40)}”.`.slice(0, 400), topics: words };
}

export type SummaryOutcome = 'written' | 'skipped' | 'unavailable' | 'raced';

/**
 * Rewrites one thread's summary from the messages after `summary_upto` — when at least
 * SUMMARY_MIN_NEW_MESSAGES finished messages are new. Throws the model's error (callers in the
 * background use `rememberThread`, which never throws).
 */
export async function summarizeThread(env: MemoryEnv, threadId: string, deps: MemoryDeps = {}): Promise<SummaryOutcome> {
  const src = await store.getSummarySource(env.DB, threadId);
  if (!src) return 'skipped';
  const { thread, messages } = src;
  const from = thread.summary_upto ? messages.findIndex((m) => m.id === thread.summary_upto) + 1 : 0;
  const fresh = messages.slice(from);
  if (fresh.length < SUMMARY_MIN_NEW_MESSAGES) return 'skipped';

  // The newest messages that fit; older ones are named, not shown.
  const lines: string[] = [];
  let used = 0;
  for (let i = fresh.length - 1; i >= 0; i--) {
    const line = `${speaker(fresh[i].role)}: ${memoryMessageText(fresh[i], SUMMARY_MESSAGE_MAX_CHARS)}`;
    if (used + line.length > SUMMARY_INPUT_MAX_CHARS && lines.length > 0) {
      lines.unshift(`(${i + 1} earlier new messages left out)`);
      break;
    }
    lines.unshift(line);
    used += line.length;
  }
  const user = [
    `Chat: ${oneLine(thread.title || 'Chat with Claude', 120)} (${badgeText(thread)})`,
    `Summary so far: ${thread.summary?.trim() || '(none yet)'}`,
    '',
    'New messages:',
    ...lines,
  ].join('\n');

  const started = Date.now();
  const out = await memoryCall(
    env,
    deps,
    'summary',
    { system: SUMMARY_SYSTEM, user, tool: SUMMARY_TOOL, validate: validateThreadSummary },
    () => fakeThreadSummary(thread.summary, fresh),
  );
  if (!out) return 'unavailable';
  const written = await store.writeThreadSummary(env.DB, threadId, thread.summary_upto, storedSummary(out.value), fresh[fresh.length - 1].id);
  await recordMemoryCall(env, thread.user_id, 'summary', out.usage, started);
  return written ? 'written' : 'raced';
}

// ---------- The learner digest + recent-threads index ----------

export interface ThreadIndexEntry {
  id: string;
  title: string;
  badge: string;
  last_at: string;
  /** One line of the summary (else the last message). */
  line: string;
}

export interface LearnerMemory {
  digest: string;
  index: ThreadIndexEntry[];
  digestAt: string | null;
}

export function parseLearnerMemory(row: store.MemoryRow | null | undefined): LearnerMemory | null {
  if (!row) return null;
  let index: ThreadIndexEntry[] = [];
  try {
    const v = JSON.parse(row.threads_index || '[]');
    if (Array.isArray(v)) index = v.filter((e) => e && typeof e.id === 'string').slice(0, THREADS_INDEX_MAX);
  } catch {
    index = [];
  }
  const digest = (row.digest || '').trim();
  if (!digest && index.length === 0) return null;
  return { digest, index, digestAt: row.digest_at };
}

export const DIGEST_TOOL = {
  name: 'write_learner_notes',
  description: 'Save the updated notes about this learner.',
  input_schema: {
    type: 'object' as const,
    properties: {
      notes: { type: 'string', description: 'The notes, at most ~300 words, short lines under the four headings.' },
    },
    required: ['notes'],
  },
};

export const DIGEST_SYSTEM = `You keep the long-term notes that Claude (an AI tutor in a Chinese flashcard app) reads at the start of every chat with this learner, so it is the same tutor every time.

From the summaries of the learner's recent chats and your previous notes, write the notes again: at most ~300 words, English, short lines under these headings —
Working on: what they are learning now (words, grammar, situations).
Keeps confusing: recurring mistakes and mix-ups (write Chinese in hanzi).
Interests: topics and situations they bring up.
Level & preferences: how good their Chinese seems and how they like answers (Chinese or English, examples, length).
Only what the chats show — never invent; drop what is stale or one-off; keep what still holds from the previous notes. No preamble.`;

export function validateDigest(v: unknown): string {
  const notes = typeof (v as { notes?: unknown })?.notes === 'string' ? ((v as { notes: string }).notes).trim() : '';
  if (!notes) throw new Error('notes missing');
  return truncateToTokens(notes, DIGEST_MAX_TOKENS);
}

/** The index from the learner's recent threads (deterministic: no model). */
export function buildThreadsIndex(rows: readonly store.MemoryThreadRow[]): ThreadIndexEntry[] {
  return rows.slice(0, THREADS_INDEX_MAX).map((r) => ({
    id: r.id,
    title: oneLine(r.title || 'Chat with Claude', 60),
    badge: badgeText(r),
    last_at: r.last_message_at ?? r.created_at,
    line: oneLine((r.summary ?? '').split('\nTopics:')[0] || r.preview || '', 110),
  }));
}

export function fakeDigest(rows: readonly store.MemoryThreadRow[]): string {
  const topics = rows.flatMap((r) => (r.summary?.match(/Topics: (.*)$/m)?.[1] ?? '').split(', ').filter(Boolean)).slice(0, 8);
  return `Working on: (E2E) ${topics.join(', ') || 'everyday Chinese'}\nKeeps confusing: —\nInterests: —\nLevel & preferences: ${rows.length} recent chats.`;
}

export type DigestOutcome = 'written' | 'skipped' | 'unavailable';

/** Rebuilds the learner's digest + index from their recent threads' summaries. Throws the model's error. */
export async function rebuildLearnerDigest(env: MemoryEnv, userId: string, deps: MemoryDeps = {}): Promise<DigestOutcome> {
  const [rows, memRes, watermark] = await Promise.all([
    store.recentThreadsForMemory(env.DB, userId, Math.max(DIGEST_SOURCE_THREADS, THREADS_INDEX_MAX)),
    store.memoryRowStatement(env.DB, userId).first<store.MemoryRow>(),
    store.newestSummaryAt(env.DB, userId),
  ]);
  if (rows.length === 0) return 'skipped';
  const index = buildThreadsIndex(rows);
  const summarised = rows.filter((r) => r.summary).slice(0, DIGEST_SOURCE_THREADS);
  const previous = (memRes?.digest ?? '').trim();

  let digest = previous;
  if (summarised.length > 0) {
    const user = [
      `Previous notes:\n${previous || '(none yet)'}`,
      '',
      'Recent chats, newest first:',
      ...summarised.map((r) => `- ${dayOf(r.last_message_at ?? r.created_at)} · ${badgeText(r)} · ${oneLine(r.title, 80)}\n  ${(r.summary ?? '').replace(/\n/g, '\n  ')}`),
    ].join('\n');
    const started = Date.now();
    const out = await memoryCall(env, deps, 'digest', { system: DIGEST_SYSTEM, user, tool: DIGEST_TOOL, validate: validateDigest }, () => fakeDigest(summarised));
    if (!out) return 'unavailable';
    digest = out.value;
    await recordMemoryCall(env, userId, 'digest', out.usage, started);
  }
  await store.saveDigest(env.DB, userId, digest, JSON.stringify(index), watermark);
  return 'written';
}

// ---------- After a reply (background) ----------

/**
 * After a reply finished in a thread: its summary, then — when enough summaries are new (or there is
 * no digest yet) — the learner's digest. Never throws; meant for `waitUntil`.
 */
export async function rememberThread(env: MemoryEnv, threadId: string, deps: MemoryDeps = {}): Promise<{ summary: SummaryOutcome | 'failed'; digest?: DigestOutcome | 'failed' }> {
  let summary: SummaryOutcome | 'failed';
  try {
    summary = await summarizeThread(env, threadId, deps);
  } catch (err) {
    console.error('[claude-memory] summary failed', threadId, err instanceof Error ? err.message : err);
    return { summary: 'failed' };
  }
  if (summary !== 'written') return { summary };
  try {
    const owner = await env.DB.prepare('SELECT user_id FROM coach_conversations WHERE id = ?').bind(threadId).first<{ user_id: string }>();
    if (!owner) return { summary };
    const { pending, hasDigest } = await store.pendingSummaries(env.DB, owner.user_id);
    if (pending < (hasDigest ? DIGEST_REBUILD_AFTER : 1)) return { summary };
    return { summary, digest: await rebuildLearnerDigest(env, owner.user_id, deps) };
  } catch (err) {
    console.error('[claude-memory] digest failed', threadId, err instanceof Error ? err.message : err);
    return { summary, digest: 'failed' };
  }
}

/**
 * `rememberThread` in the background: the given `waitUntil`, else the request / queue scope's, else a
 * floating (caught) promise. `messageId` = a reply that just finished (its thread is looked up).
 */
export function rememberInBackground(
  env: MemoryEnv,
  ref: { threadId: string } | { messageId: string },
  opts: { waitUntil?: (p: Promise<unknown>) => void; deps?: MemoryDeps } = {},
): Promise<unknown> {
  const work = (async () => {
    const threadId =
      'threadId' in ref
        ? ref.threadId
        : (await env.DB.prepare('SELECT conversation_id FROM coach_messages WHERE id = ?').bind(ref.messageId).first<{ conversation_id: string }>())?.conversation_id;
    if (threadId) await rememberThread(env, threadId, opts.deps);
  })().catch((err) => console.error('[claude-memory] background failed', err instanceof Error ? err.message : err));
  try {
    (opts.waitUntil ?? currentScope()?.waitUntil)?.(work);
  } catch {
    // waitUntil after the response (tests / odd runtimes): the promise still runs.
  }
  return work;
}

/**
 * The daily cron: summaries for threads active in the last 30 days that are behind (at most
 * CRON_MAX_SUMMARIES calls), then the digest of every learner with summaries it hasn't folded in.
 */
export async function runClaudeMemoryCron(
  env: MemoryEnv,
  opts: { now?: number; deps?: MemoryDeps; maxSummaries?: number; maxDigests?: number; deadlineMs?: number } = {},
): Promise<{ summaries: number; skipped: number; digests: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const deadline = Date.now() + (opts.deadlineMs ?? 8 * 60_000);
  const out = { summaries: 0, skipped: 0, digests: 0, failed: 0 };
  if (env.E2E_TEST_MODE !== 'true' && !env.ANTHROPIC_API_KEY && !opts.deps?.client) return out;
  const since = new Date(now - CRON_SUMMARY_DAYS * 86_400_000).toISOString();
  for (const t of await store.threadsNeedingSummary(env.DB, since, opts.maxSummaries ?? CRON_MAX_SUMMARIES)) {
    if (Date.now() > deadline) break;
    try {
      const r = await summarizeThread(env, t.id, opts.deps);
      if (r === 'written') out.summaries++;
      else out.skipped++;
    } catch (err) {
      out.failed++;
      console.error('[claude-memory] cron summary failed', t.id, err instanceof Error ? err.message : err);
    }
  }
  for (const userId of await store.usersNeedingDigest(env.DB, opts.maxDigests ?? CRON_MAX_DIGESTS)) {
    if (Date.now() > deadline) break;
    try {
      if ((await rebuildLearnerDigest(env, userId, opts.deps)) === 'written') out.digests++;
    } catch (err) {
      out.failed++;
      console.error('[claude-memory] cron digest failed', userId, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ---------- In the prompt ----------

/**
 * The memory as one system-prompt block (≤ MEMORY_BLOCK_MAX_TOKENS): the digest, then the recent chats
 * newest first with a short id read_chat accepts. '' when there is nothing yet. Made only from the
 * stored row, so it is the same until the next rebuild (cached with the learner block).
 */
export function memoryBlock(mem: LearnerMemory | null): string {
  if (!mem) return '';
  const head = [
    '## What you know from earlier chats',
    "Your own notes from this learner's earlier chats with you (you are the same Claude in every chat). Use them when they help; never recite them; if they seem wrong, trust what the learner says now. To look something up, call search_my_chats or read_chat (without announcing it).",
  ].join('\n');
  const parts = [head];
  // The digest leaves room for the index (it is asked for ~300 words, so this rarely cuts).
  if (mem.digest) parts.push(truncateToTokens(mem.digest, MEMORY_DIGEST_SHARE));
  let text = parts.join('\n\n');
  if (mem.index.length) {
    const rows: string[] = [];
    let budget = MEMORY_BLOCK_MAX_TOKENS - estimateTokens(text) - estimateTokens('\n\nRecent chats (newest first):');
    for (const e of mem.index) {
      const row = `- ${dayOf(e.last_at)} · ${e.badge} · ${oneLine(e.title, 30)}${e.line ? ` — ${oneLine(e.line, 80)}` : ''} (chat ${e.id.slice(0, 12)})`;
      const cost = estimateTokens(row) + 1;
      if (cost > budget) break;
      rows.push(row);
      budget -= cost;
    }
    if (rows.length) text += `\n\nRecent chats (newest first):\n${rows.join('\n')}`;
  }
  return text;
}

// ---------- History compaction ----------

type TextMessage = { role: 'user' | 'assistant'; content: string | Anthropic.MessageParam['content'] };

const messageTokens = (m: TextMessage) => estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

export interface Compacted<M> {
  messages: M[];
  /** For the context block: what was left out, and the thread's summary ('' = not compacted). */
  note: string;
  dropped: number;
}

/**
 * A long thread's messages within `budgetTokens`: the FIRST message (the context's framing — the card's
 * facts, the Coach's sentence, the discussed message) + the last `keepTurns` turns (fewer while over the
 * budget); the dropped middle is described by the thread's summary in the context block. Roles stay
 * alternating (the tail starts with a reply; two learner turns in a row are merged). Unchanged when it fits.
 */
export function compactMessages<M extends TextMessage>(
  messages: readonly M[],
  opts: { summary?: string | null; budgetTokens?: number; keepTurns?: number; threadId?: string | null } = {},
): Compacted<M> {
  const budget = opts.budgetTokens ?? HISTORY_TOKEN_BUDGET;
  const keep = Math.max(1, opts.keepTurns ?? HISTORY_KEEP_TURNS);
  const n = messages.length;
  const costs = messages.map(messageTokens);
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= budget || n <= 2) return { messages: messages.slice(), note: '', dropped: 0 };

  const first = messages[0];
  let start = Math.max(1, n - keep);
  // The tail opens with the other role than the first message (alternation).
  if (messages[start].role === first.role && start + 1 < n) start += 1;
  const tailCost = (s: number) => costs.slice(s).reduce((a, b) => a + b, 0);
  while (start + 2 < n && costs[0] + tailCost(start) > budget) start += 2;
  const dropped = start - 1;
  if (dropped <= 0) return { messages: messages.slice(), note: '', dropped: 0 };

  const tail = messages.slice(start);
  let out: M[];
  if (tail[0].role === first.role && typeof first.content === 'string' && typeof tail[0].content === 'string') {
    out = [{ ...first, content: `${first.content}\n\n(…)\n\n${tail[0].content}` }, ...tail.slice(1)];
  } else {
    out = [first, ...tail];
  }

  const summary = opts.summary?.trim();
  const earlier = summary
    ? `Summary of the chat so far: ${summary}`
    : `The learner's left-out messages began: ${messages
        .slice(1, start)
        .filter((m) => m.role === 'user' && typeof m.content === 'string')
        .slice(-8)
        .map((m) => `「${oneLine(m.content as string, 80)}」`)
        .join(' ')}`;
  const note = [
    `## Earlier in this chat`,
    `${dropped} older messages between the first one and the last ${tail.length} are left out to keep this short.`,
    earlier,
    opts.threadId ? `(read_chat with thread_id "${opts.threadId}" shows them if you need the details.)` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { messages: out, note, dropped };
}

/** What a turn reads of the memory: the learner's row and the thread's summary — one batch, never throws. */
export async function loadTurnMemory(db: D1Database, userId: string, threadId?: string | null): Promise<{ memory: LearnerMemory | null; threadSummary: string | null }> {
  try {
    const statements = [store.memoryRowStatement(db, userId)];
    if (threadId) statements.push(store.threadSummaryStatement(db, userId, threadId));
    const [mem, thread] = await db.batch<Record<string, unknown>>(statements);
    const row = mem.results?.[0] as unknown as store.MemoryRow | undefined;
    const summary = (thread?.results?.[0] as { summary?: string | null } | undefined)?.summary ?? null;
    return { memory: parseLearnerMemory(row), threadSummary: summary };
  } catch (err) {
    console.error('[claude-memory] load failed', err instanceof Error ? err.message : err);
    return { memory: null, threadSummary: null };
  }
}
