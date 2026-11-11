/**
 * "New day starts at" (services/study-day.ts, shared/study/studyDay.ts). Mounted under /api after auth.
 *
 *   PUT /profile/day-rollover { day_rollover_hour: 0–6 | null } → { day_rollover_hour, is_default }
 *
 * null = back to the default (4 am). `/api/auth/me` and `/api/sync/changes` carry the hour in
 * effect as `day_rollover_hour`, so both apps follow a change on the next sync.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { pickDayRolloverUpdate } from '../../../shared/study/studyDay';
import { setDayRolloverHour } from '../services/study-day';

const dayRollover = new Hono<{ Bindings: Env }>();

dayRollover.put('/profile/day-rollover', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { value, problems } = pickDayRolloverUpdate(body);
  if (problems.length > 0) return c.json({ error: problems[0], problems }, 400);
  const hour = await setDayRolloverHour(c.env.DB, userId, value);
  return c.json({ day_rollover_hour: hour, is_default: value === null });
});

export default dayRollover;
