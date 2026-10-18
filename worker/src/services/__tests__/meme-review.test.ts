/**
 * 梗 Meme review (prototype): the research agent's loop with a mocked model + mocked search
 * results (URLs collected from tool results only, pause_turn, nudge, repair rounds, budgets,
 * checkpoint / resume), the job over real SQLite + a fake R2 (research → illustrate → ready,
 * a redelivery resuming), the routes (generate is admin only, the lesson goes to the caller), the
 * cron rule, and the E2E stand-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { SAMPLE_MEME_SEEN_URLS, SAMPLE_MEME_SUBMISSION } from '@shared/meme-review';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  MAX_SEARCHES,
  MAX_SUBMITS,
  MEME_NUDGE,
  memeCostUsd,
  memeTools,
  newMemeAgentState,
  runMemeAgent,
  urlsFromToolResults,
  type MemeAgentState,
  type MemeModelCall,
} from '../meme-review/agent';
import { agentKey, ensureMonthlyMemeIssue, getMemeIssue, requestMemeIssue, runMemeIssueJob, runMemeIssueUntilSettled } from '../meme-review/job';
import { fakeMemeLessonSpec, runMemeLessonJob, memeLessonProblems } from '../meme-review/lesson';
import { fakeMemeCall } from '../meme-review/fake';
import { pinyinLine } from '../podcasts/segments';
import memeReview from '../../routes/meme-review';
import type { Env } from '../../types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const covers = { from: '2026-08-23', to: '2026-10-18' };

function searchTurn(urls: string[], id = 'srv1') {
  return [
    { type: 'server_tool_use', id, name: 'web_search', input: { query: '网络热词' } },
    { type: 'web_search_tool_result', tool_use_id: id, content: urls.map((url) => ({ type: 'web_search_result', url, title: 't', encrypted_content: 'abc' })) },
  ];
}
const submit = (input: unknown, id = 'tu1') => [{ type: 'tool_use', id, name: 'submit_issue', input }];

/** A scripted model: each call returns the next reply. */
function scripted(replies: Array<Awaited<ReturnType<MemeModelCall>>>) {
  const calls: Array<{ messages: unknown[]; tools: unknown[] }> = [];
  const call: MemeModelCall = async ({ messages, tools }) => {
    calls.push({ messages: clone(messages), tools });
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    return next;
  };
  return { call, calls };
}

const run = (state: MemeAgentState, call: MemeModelCall, extra: Partial<Parameters<typeof runMemeAgent>[0]> = {}) => {
  const checkpoints: string[] = [];
  return runMemeAgent({
    month: '2026-10',
    covers,
    state,
    call,
    derivePinyin: pinyinLine,
    deadline: Date.now() + 60_000,
    checkpoint: async (_s, p) => {
      checkpoints.push(p);
    },
    ...extra,
  }).then((outcome) => ({ outcome, checkpoints }));
};

describe('urlsFromToolResults', () => {
  it('takes URLs from tool results and citations, never from what the model wrote', () => {
    const urls = urlsFromToolResults([
      { type: 'text', text: 'I remember https://made.up/from-memory', citations: [{ type: 'web_search_result_location', url: 'https://cited.example/a' }] },
      { type: 'server_tool_use', id: 's', name: 'web_fetch', input: { url: 'https://typed.by/model' } },
      ...searchTurn(['https://a.example/1']),
      { type: 'web_fetch_tool_result', tool_use_id: 'f', content: { type: 'web_fetch_result', url: 'https://fetched.example/p', content: { type: 'document', source: { type: 'text', data: 'see https://inside.page/link.' } } } },
      { type: 'bash_code_execution_tool_result', tool_use_id: 'c', content: { type: 'bash_code_execution_result', stdout: 'filtered: https://filtered.example/x, done', stderr: '' } },
    ]);
    expect(urls.sort()).toEqual(['https://a.example/1', 'https://cited.example/a', 'https://fetched.example/p', 'https://filtered.example/x', 'https://inside.page/link'].sort());
  });
});

describe('runMemeAgent', () => {
  it('searches, resumes a pause_turn, and is accepted only with URLs the search returned', async () => {
    const { call, calls } = scripted([
      { stop_reason: 'pause_turn', content: searchTurn(SAMPLE_MEME_SEEN_URLS), usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 3 } } },
      { stop_reason: 'tool_use', content: submit(SAMPLE_MEME_SUBMISSION), usage: { input_tokens: 2000, output_tokens: 3000 } },
    ]);
    const state = newMemeAgentState('brief');
    const { outcome, checkpoints } = await run(state, call);
    expect(outcome.kind).toBe('done');
    if (outcome.kind !== 'done') return;
    expect(outcome.issue.items).toHaveLength(6);
    expect(outcome.notes.some((n) => n.includes('example.com/made-up-from-memory'))).toBe(true);
    // pause_turn: called again with the paused turn as the last message, nothing added.
    expect((calls[1].messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.searches).toBe(3);
    expect(state.rounds).toBe(2);
    expect(state.usage.output_tokens).toBe(3100);
    expect(checkpoints.at(-1)).toBe('Issue written');
    // The pinyin is the app's, not the model's.
    expect(outcome.issue.items[1].pinyin).toBe('dāzi');
  });

  it('refuses invented URLs and repairs; gives up after the submit budget', async () => {
    const invented = clone(SAMPLE_MEME_SUBMISSION);
    // No search ran, so nothing is "seen": every item loses its sources.
    const { call, calls } = scripted(Array.from({ length: MAX_SUBMITS }, (_, i) => ({ stop_reason: 'tool_use', content: submit(invented, `tu${i}`) })));
    const { outcome } = await run(newMemeAgentState('brief'), call);
    expect(outcome.kind).toBe('failed');
    const second = calls[1].messages as Array<{ role: string; content: Array<{ type: string; is_error?: boolean; content: string }> }>;
    const result = second.at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/only 0 usable memes/);
    expect(result.content).toMatch(/was not in your search \/ fetch results/);
  });

  it('nudges once when a turn ends without submit_issue, then fails', async () => {
    const { call, calls } = scripted([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the issue in prose.' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Still prose.' }] },
    ]);
    const { outcome } = await run(newMemeAgentState('brief'), call);
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'Claude stopped without handing in an issue' });
    expect((calls[1].messages as Array<{ content: unknown }>).at(-1)!.content).toBe(MEME_NUDGE);
  });

  it('a refusal fails the run', async () => {
    const { call } = scripted([{ stop_reason: 'refusal', content: [] }]);
    expect((await run(newMemeAgentState('brief'), call)).outcome).toMatchObject({ kind: 'failed', reason: 'Claude declined to write this issue' });
  });

  it('keeps each request inside the search budget', () => {
    expect(memeTools({ searches: 0, fetches: 0 })[0]).toMatchObject({ type: 'web_search_20260209', max_uses: 10 });
    expect(memeTools({ searches: MAX_SEARCHES - 3, fetches: 9 })[0]).toMatchObject({ max_uses: 3 });
    expect(memeTools({ searches: MAX_SEARCHES, fetches: 10 })[1]).toMatchObject({ type: 'web_fetch_20260209', max_uses: 1 });
  });

  it('stops at the deadline and resumes from the checkpoint (a pending submit_issue runs first)', async () => {
    let t = 0;
    const { call } = scripted([{ stop_reason: 'pause_turn', content: searchTurn(SAMPLE_MEME_SEEN_URLS), usage: { server_tool_use: { web_search_requests: 1 } } }]);
    const state = newMemeAgentState('brief');
    const first = await run(state, call, { now: () => (t += 1000), deadline: 500 });
    expect(first.outcome.kind).toBe('continue');
    // A later delivery: the model had answered with submit_issue but the worker died before running it.
    const saved = clone(state);
    saved.messages.push({ role: 'assistant', content: submit(SAMPLE_MEME_SUBMISSION) as never });
    const never: MemeModelCall = async () => {
      throw new Error('must not call the model');
    };
    const second = await run(saved, never);
    expect(second.outcome.kind).toBe('done');
  });

  it('estimates the cost', () => {
    expect(memeCostUsd({ input_tokens: 100_000, output_tokens: 20_000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 50_000 }, 25, 8)).toBe(1.916);
  });
});

// ---------- The job over SQLite + a fake R2 ----------

function fakeBucket() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? { json: async () => JSON.parse(store.get(key)!) } : null)),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, typeof value === 'string' ? value : '[bytes]');
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function makeEnv(db: SqliteD1, extra: Record<string, unknown> = {}) {
  const bucket = fakeBucket();
  return { env: { DB: db, AUDIO_BUCKET: bucket, ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'g', ...extra } as unknown as Env, bucket };
}

describe('the monthly job', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
  });

  it('research → illustrate → ready, with the counters and the checkpoint in R2', async () => {
    const { env, bucket } = makeEnv(db, { E2E_TEST_MODE: 'true' });
    const draw = vi.fn(async ({ itemId }: { itemId: string }) => (itemId === 'm3' ? null : `meme-review/images/2026-10/${itemId}.png`));
    await db.prepare(`INSERT INTO meme_issues (month, status, phase) VALUES ('2026-10', 'generating', 'research')`).run();
    const outcome = await runMemeIssueUntilSettled(env, '2026-10', { call: fakeMemeCall({ delayMs: 0 }), draw, today: '2026-10-18' });
    expect(outcome).toBe('ready');
    const record = await getMemeIssue(db, '2026-10');
    expect(record.status).toBe('ready');
    expect(record.issue!.covers).toEqual({ from: '2026-08-23', to: '2026-10-18' });
    expect(record.issue!.items.map((i) => i.picture.image_key)).toEqual([
      'meme-review/images/2026-10/m1.png', 'meme-review/images/2026-10/m2.png', null,
      'meme-review/images/2026-10/m4.png', 'meme-review/images/2026-10/m5.png', 'meme-review/images/2026-10/m6.png',
    ]);
    const row = db.rows<Record<string, number | string>>('SELECT rounds, searches, images, cost_usd, agent_key FROM meme_issues')[0];
    expect(row).toMatchObject({ rounds: 2, searches: 2, images: 5, agent_key: agentKey('2026-10') });
    expect(Number(row.cost_usd)).toBeGreaterThan(0);
    expect(bucket.store.has(agentKey('2026-10'))).toBe(true);
  });

  it('a delivery past its deadline continues; the next resumes without starting over', async () => {
    const { env } = makeEnv(db);
    await db.prepare(`INSERT INTO meme_issues (month, status, phase) VALUES ('2026-10', 'generating', 'research')`).run();
    let calls = 0;
    const call: MemeModelCall = async (req) => {
      calls += 1;
      return fakeMemeCall({ delayMs: 0 })(req);
    };
    let t = 0;
    const first = await runMemeIssueJob(env, '2026-10', { call, now: () => (t += 10_000), deliveryMs: 5_000, today: '2026-10-18', draw: async () => null });
    expect(first).toBe('continue');
    expect(calls).toBe(1);
    const second = await runMemeIssueJob(env, '2026-10', { call, today: '2026-10-18', draw: async () => null });
    expect(second).toBe('ready');
    expect(calls).toBe(2);
  });

  it('requestMemeIssue keeps a ready issue unless regenerate; the cron starts only on the 1st–2nd', async () => {
    const { env } = makeEnv(db, { E2E_TEST_MODE: 'true' });
    const first = await requestMemeIssue(env, '2026-10', { via: 'admin' });
    expect(first.started).toBe(true);
    expect(first.record.status).toBe('ready');
    expect((await requestMemeIssue(env, '2026-10', { via: 'admin' })).started).toBe(false);
    expect(await ensureMonthlyMemeIssue(env, Date.UTC(2026, 9, 18, 3, 17))).toBe('not_today');
    expect(await ensureMonthlyMemeIssue(env, Date.UTC(2026, 9, 1, 3, 17))).toBe('exists');
    expect(await ensureMonthlyMemeIssue(env, Date.UTC(2026, 10, 1, 3, 17))).toBe('started');
    expect((await getMemeIssue(db, '2026-11')).status).toBe('ready');
  });
});

// ---------- Routes ----------

function makeApp(db: SqliteD1, user: { id: string; is_admin?: boolean } | null) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    await next();
  });
  app.route('/api', memeReview);
  const { env } = makeEnv(db, { E2E_TEST_MODE: 'true' });
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  // Each request settles its background work (the inline generation) before returning.
  const req = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init, env, ctx);
    while (pending.length) await pending.shift();
    return res;
  };
  const post = (path: string, body: unknown = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { req, post, env };
}

describe('meme-review routes', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name, is_admin) VALUES ('admin', 'a@x.test', 'Admin', 1), ('u1', 'u1@x.test', 'U1', 0)");
  });

  it('needs a signed-in user', async () => {
    const app = makeApp(db, null);
    expect((await app.req('/api/meme-review')).status).toBe(401);
    expect((await app.req('/api/meme-review/2026-10')).status).toBe(401);
    expect((await app.post('/api/meme-review/generate')).status).toBe(401);
  });

  it('generate is admin only', async () => {
    const user = makeApp(db, { id: 'u1' });
    expect((await user.post('/api/meme-review/generate', { month: '2026-10' })).status).toBe(403);
    const list = await (await user.req('/api/meme-review')).json() as { issues: unknown[]; can_generate: boolean };
    expect(list).toMatchObject({ issues: [], can_generate: false });

    const admin = makeApp(db, { id: 'admin', is_admin: true });
    expect((await admin.post('/api/meme-review/generate', { month: '26-10' })).status).toBe(400);
    expect((await admin.post('/api/meme-review/generate', { month: '2999-01' })).status).toBe(400);
    const res = await admin.post('/api/meme-review/generate', { month: '2026-10' });
    expect(res.status).toBe(202);
    const detail = await (await admin.req('/api/meme-review/2026-10')).json() as { issue: { status: string }; stats?: unknown };
    expect(detail.issue.status).toBe('ready');
    expect(detail.stats).toBeTruthy();
    // Everyone reads it; only the admin sees the stats.
    const seen = await (await user.req('/api/meme-review/2026-10')).json() as { issue: { status: string; issue: { items: unknown[] } }; stats?: unknown };
    expect(seen.issue.issue.items).toHaveLength(6);
    expect(seen.stats).toBeUndefined();
    const summaries = await (await user.req('/api/meme-review')).json() as { issues: Array<{ month: string; item_count: number; preview: string[] }> };
    expect(summaries.issues[0]).toMatchObject({ month: '2026-10', item_count: 6, preview: ['City不City', '搭子', '班味', '显眼包'] });
  });

  it('makes a mini lesson in the CALLER’s account', async () => {
    const admin = makeApp(db, { id: 'admin', is_admin: true });
    await admin.post('/api/meme-review/generate', { month: '2026-10' });
    const user = makeApp(db, { id: 'u1' });
    expect((await user.post('/api/meme-review/2026-09/lesson')).status).toBe(409);
    const res = await user.post('/api/meme-review/2026-10/lesson');
    expect(res.status).toBe(202);
    const started = (await res.json() as { job: { id: string; status: string } }).job;
    expect(started.status).toBe('generating');
    const { job } = await (await user.req(`/api/meme-review/lessons/${started.id}`)).json() as { job: { id: string; status: string; lesson_id: string } };
    expect(job.status).toBe('ready');
    const lessons = db.rows<{ user_id: string; title: string }>('SELECT user_id, title FROM custom_lessons');
    expect(lessons).toEqual([{ user_id: 'u1', title: '梗 · October 2026 memes' }]);
    const again = await (await user.req(`/api/meme-review/lessons/${job.id}`)).json() as { job: { lesson_id: string } };
    expect(again.job.lesson_id).toBe(job.lesson_id);
    // Another user can't read it.
    expect((await makeApp(db, { id: 'admin', is_admin: true }).req(`/api/meme-review/lessons/${job.id}`)).status).toBe(404);
  });
});

describe('the lesson writer', () => {
  it('the stand-in passes the lesson validator; the real path repairs with the problems', async () => {
    const db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U1')");
    const { env } = makeEnv(db, { E2E_TEST_MODE: 'true' });
    await requestMemeIssue(env, '2026-10', { via: 'admin' });
    const issue = (await getMemeIssue(db, '2026-10')).issue!;
    expect(memeLessonProblems(fakeMemeLessonSpec(issue)).length).toBeGreaterThan(0); // the stand-in is short on purpose

    const good = fakeMemeLessonSpec(issue);
    good.sections[1].exercises.push(
      { type: 'scramble', english: 'x', tiles: ['我', '在'], correct_order: ['我', '在'] } as never,
      ...Array.from({ length: 4 }, () => good.sections[1].exercises[1]),
    );
    const create = vi.fn()
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_lesson_spec', input: { title: 'x', sections: [] } }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'create_lesson_spec', input: good }] });
    db.raw.run("INSERT INTO meme_review_lessons (id, user_id, month, status) VALUES ('j1', 'u1', '2026-10', 'generating')");
    expect(await runMemeLessonJob(env as never, 'j1', { create })).toBe('ready');
    expect(create).toHaveBeenCalledTimes(2);
    const repair = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(repair).toMatchObject({ type: 'tool_result', is_error: true });
  });
});
