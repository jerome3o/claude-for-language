/**
 * Active study time per local day (docs/STUDY_SESSION.md "Time"; migration 0083).
 * Mounted under /api after the auth middleware.
 *
 *   PUT /me/study-time  { device_id, days: [{ date, active_ms }] }  this device's running per-day totals
 *   GET /me/study-time?from=YYYY-MM-DD&device_id=                  per-day totals over every device
 *
 * A device's row only ever goes up (MAX), so a report can be re-sent any number of times
 * (offline retries, two tabs). Both answer `{ days: [{ date, active_ms, device_ms }] }`:
 * `active_ms` = all devices, `device_ms` = the calling device's share, so the client can
 * add its own fresher local number to everyone else's (dayTotalAcrossDevices).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { pickStudyTimeDays } from '@shared/study';

const studyTime = new Hono<{ Bindings: Env }>();

/** How far back GET goes by default. */
const DEFAULT_DAYS = 14;

function validDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export interface StudyTimeDayTotal {
  date: string;
  active_ms: number;
  device_ms: number;
}

async function totals(db: D1Database, userId: string, from: string, deviceId: string | null): Promise<StudyTimeDayTotal[]> {
  const res = await db
    .prepare(
      `SELECT local_date AS date,
              SUM(active_ms) AS active_ms,
              SUM(CASE WHEN device_id = ? THEN active_ms ELSE 0 END) AS device_ms
       FROM study_time_days
       WHERE user_id = ? AND local_date >= ?
       GROUP BY local_date
       ORDER BY local_date`,
    )
    .bind(deviceId ?? '', userId, from)
    .all<StudyTimeDayTotal>();
  return (res.results ?? []).map((r) => ({ date: r.date, active_ms: Number(r.active_ms) || 0, device_ms: Number(r.device_ms) || 0 }));
}

studyTime.put('/me/study-time', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ device_id?: unknown; days?: unknown }>().catch(() => null);
  if (!body || !validDeviceId(body.device_id)) {
    return c.json({ error: 'device_id must be 8–64 letters, digits, - or _', problems: ['device_id'] }, 400);
  }
  const { days, problems } = pickStudyTimeDays(body.days);
  if (problems.length > 0) return c.json({ error: 'Invalid study time', problems }, 400);
  const deviceId = body.device_id;
  if (days.length > 0) {
    await c.env.DB.batch(
      days.map((d) =>
        c.env.DB
          .prepare(
            `INSERT INTO study_time_days (user_id, local_date, device_id, active_ms, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT (user_id, local_date, device_id)
             DO UPDATE SET active_ms = MAX(study_time_days.active_ms, excluded.active_ms),
                           updated_at = excluded.updated_at`,
          )
          .bind(user.id, d.date, deviceId, d.active_ms),
      ),
    );
  }
  const from = days[0]?.date && days[0].date < isoDaysAgo(DEFAULT_DAYS) ? days[0].date : isoDaysAgo(DEFAULT_DAYS);
  return c.json({ days: await totals(c.env.DB, user.id, from, deviceId) });
});

studyTime.get('/me/study-time', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const fromParam = c.req.query('from');
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : isoDaysAgo(DEFAULT_DAYS);
  const deviceParam = c.req.query('device_id');
  const deviceId = validDeviceId(deviceParam) ? deviceParam : null;
  return c.json({ days: await totals(c.env.DB, user.id, from, deviceId) });
});

export default studyTime;
