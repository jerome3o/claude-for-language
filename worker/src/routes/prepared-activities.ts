/**
 * Prepared in-call activities + "What <student> has covered" (docs/VIDEO_CALLS.md
 * "Prepared activities"; services/prepared-activities/). TUTOR ONLY — the
 * student never reads these (403), and nothing here reaches them.
 *
 *   GET  /relationships/:relId/prepared-activities          → { activities, job, can_prepare }
 *   POST /relationships/:relId/prepared-activities          { count? } → 202 { job } (200 + { job, started: false } while one runs; 503 without a key)
 *   POST /prepared-activities/:id/dismiss | /restore        → { activity }
 *   GET  /relationships/:relId/coverage                     → { coverage }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { guardTutorOf } from './student-profile';
import { DEFAULT_PREPARE_COUNT, MAX_PREPARE_COUNT, orderPrepared } from '@shared/call-activities';
import { canPrepare, getPrepared, latestJob, listPrepared, loadCoverage, prepareNow, relationshipPeople, setPreparedStatus, toJob } from '../services/prepared-activities';

const preparedActivities = new Hono<{ Bindings: Env }>();

preparedActivities.get('/relationships/:relId/prepared-activities', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const [list, job] = await Promise.all([listPrepared(c.env.DB, g.rel.id), latestJob(c.env.DB, g.rel.id)]);
  return c.json({ activities: orderPrepared(list), job: job ? toJob(job) : null, can_prepare: canPrepare(c.env) });
});

preparedActivities.post('/relationships/:relId/prepared-activities', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  if (!canPrepare(c.env)) return c.json({ error: 'Preparing activities needs Claude, which isn’t set up here' }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
  const count = typeof body.count === 'number' && Number.isFinite(body.count) ? Math.max(1, Math.min(MAX_PREPARE_COUNT, Math.round(body.count))) : DEFAULT_PREPARE_COUNT;
  const people = await relationshipPeople(c.env.DB, g.rel.id);
  if (!people) return c.json({ error: 'Relationship not found or not active' }, 404);
  const { job, started } = await prepareNow(c.env, people, count);
  return c.json({ job: toJob(job), started }, started ? 202 : 200);
});

async function changeStatus(c: import('hono').Context<{ Bindings: Env }>, status: 'ready' | 'dismissed') {
  const userId = c.get('user').id;
  const a = await getPrepared(c.env.DB, c.req.param('id') ?? '');
  if (!a) return c.json({ error: 'Not found' }, 404);
  if (a.tutor_id !== userId) return c.json({ error: 'Only the tutor who prepared it can change it' }, 403);
  // A used one stays used (its result is with the lesson); dismiss hides it, restore brings a dismissed one back as ready.
  if (status === 'dismissed' || a.status === 'dismissed') await setPreparedStatus(c.env.DB, a.id, status);
  const after = await getPrepared(c.env.DB, a.id);
  const { tutor_id: _t, ...activity } = after!;
  return c.json({ activity });
}

preparedActivities.post('/prepared-activities/:id/dismiss', (c) => changeStatus(c, 'dismissed'));
preparedActivities.post('/prepared-activities/:id/restore', (c) => changeStatus(c, 'ready'));

preparedActivities.get('/relationships/:relId/coverage', async (c) => {
  const userId = c.get('user').id;
  const g = await guardTutorOf(c.env.DB, c.req.param('relId'), userId);
  if (!g.ok) return c.json({ error: g.error }, g.status);
  const people = await relationshipPeople(c.env.DB, g.rel.id);
  if (!people) return c.json({ error: 'Relationship not found or not active' }, 404);
  return c.json({ coverage: await loadCoverage(c.env.DB, people) });
});

export default preparedActivities;
