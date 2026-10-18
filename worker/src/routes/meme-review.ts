/**
 * 梗 Meme review (PROTOTYPE; services/meme-review/, shared/meme-review, docs/MEME_REVIEW.md).
 * Mounted under /api after the auth middleware. Issues are global: one per month, for everyone.
 *
 *   GET  /meme-review                    → { issues: MemeIssueSummary[], current_month, can_generate }
 *   GET  /meme-review/:month             → { issue: MemeIssueRecord, lesson: MemeLessonJob | null, stats? (admin) }
 *   POST /meme-review/generate { month?, regenerate?, via? } → admin only: 202 { issue } (200 when kept)
 *   POST /meme-review/:month/lesson      → "Make a mini lesson": 202 { job } in the CALLER's account
 *   GET  /meme-review/lessons/:jobId     → { job }
 */
import { Hono, type Context, type Next } from 'hono';
import { isMemeMonth, memeMonthOf } from '@shared/meme-review';
import type { Env } from '../types';
import { adminMiddleware } from '../middleware/auth';
import { getMemeIssue, listMemeIssues, memeIssueStats, requestMemeIssue } from '../services/meme-review/job';
import { getMemeLessonJob, latestMemeLessonJob, requestMemeLesson } from '../services/meme-review/lesson';

const memeReview = new Hono<{ Bindings: Env }>();

// Signed-in only (the app mounts this after the auth middleware; this keeps the routes safe on their own).
const signedIn = async (c: Context<{ Bindings: Env }>, next: Next) => (c.get('user') ? next() : c.json({ error: 'Unauthorized' }, 401));
memeReview.use('/meme-review', signedIn);
memeReview.use('/meme-review/*', signedIn);

memeReview.get('/meme-review', async (c) => {
  const user = c.get('user');
  return c.json({ issues: await listMemeIssues(c.env.DB), current_month: memeMonthOf(Date.now()), can_generate: !!user?.is_admin });
});

memeReview.post('/meme-review/generate', adminMiddleware, async (c) => {
  const body = await c.req.json<{ month?: unknown; regenerate?: unknown; via?: unknown }>().catch(() => ({} as { month?: unknown; regenerate?: unknown; via?: unknown }));
  const month = typeof body.month === 'string' && body.month ? body.month : memeMonthOf(Date.now());
  if (!isMemeMonth(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  if (month > memeMonthOf(Date.now())) return c.json({ error: 'That month hasn’t started yet.' }, 400);
  const via = body.via === 'mcp' ? 'mcp' : 'admin';
  const { record, started } = await requestMemeIssue(c.env, month, { via, regenerate: body.regenerate === true, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  return c.json({ issue: record, started }, started ? 202 : 200);
});

memeReview.get('/meme-review/lessons/:jobId', async (c) => {
  const job = await getMemeLessonJob(c.env.DB, c.get('user').id, c.req.param('jobId'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job });
});

memeReview.get('/meme-review/:month', async (c) => {
  const month = c.req.param('month');
  if (!isMemeMonth(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const user = c.get('user');
  const [issue, lesson] = await Promise.all([getMemeIssue(c.env.DB, month), latestMemeLessonJob(c.env.DB, user.id, month)]);
  const stats = user.is_admin ? await memeIssueStats(c.env.DB, month) : null;
  return c.json({ issue, lesson, ...(stats ? { stats } : {}) });
});

memeReview.post('/meme-review/:month/lesson', async (c) => {
  const month = c.req.param('month');
  if (!isMemeMonth(month)) return c.json({ error: 'month must be YYYY-MM' }, 400);
  const out = await requestMemeLesson(c.env, c.get('user').id, month, { waitUntil: (p) => c.executionCtx.waitUntil(p) });
  if (!out.job) return c.json({ error: out.error ?? 'Couldn’t start the lesson' }, out.status ?? 409);
  return c.json({ job: out.job }, out.job.status === 'generating' ? 202 : 200);
});

export default memeReview;
