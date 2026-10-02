/**
 * Study-state debug reports (see services/debug-reports.ts, shared/debug).
 * Mounted under /api after the auth middleware; every report belongs to the
 * signed-in user and only they can read or compare it.
 *
 *   POST /debug/reports            { client: 'lab'|'web', app_version, install_kind?, report }
 *                                  (JSON, or the same JSON gzip-compressed with Content-Type application/gzip)
 *   GET  /debug/reports?client=&limit=         index rows, newest first
 *   GET  /debug/reports/:id?section=overview|decks|cards|events|full&offset&limit&deck_id&queue&in_due_queue&card_id
 *   GET  /debug/compare?a=&b=&max_cards=&server=0   diff (defaults: newest lab vs newest web)
 *   POST /debug/crash              { client?, app_version?, device?, crashes: [{ id, source, at, reason?, thread?, description?, trace? }] }
 *                                  (sent the moment a crash / freeze happens; services/crash-reports.ts)
 *   GET  /debug/crashes?client=&limit=&trace_chars=   newest first, with the traces
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  DebugReportError,
  compareStoredReports,
  listDebugReports,
  loadDebugReport,
  readUploadBody,
  sliceDebugReport,
  storeDebugReport,
} from '../services/debug-reports';
import { listCrashes, storeCrashes } from '../services/crash-reports';

const debugReports = new Hono<{ Bindings: Env }>();

function fail(c: { json: (b: unknown, s: number) => Response }, err: unknown, what: string) {
  if (err instanceof DebugReportError) {
    return c.json({ error: err.message, ...(err.problems ? { problems: err.problems } : {}) }, err.status);
  }
  console.error(`[debug-reports] ${what} failed:`, err);
  return c.json({ error: `${what} failed` }, 500);
}

debugReports.post('/debug/reports', async (c) => {
  try {
    const { body, size } = await readUploadBody(c.req.raw);
    const row = await storeDebugReport(c.env, c.get('user').id, body, size);
    return c.json({ report: row }, 201);
  } catch (err) {
    return fail(c, err, 'Upload');
  }
});

debugReports.get('/debug/reports', async (c) => {
  try {
    const reports = await listDebugReports(c.env.DB, c.get('user').id, c.req.query('client'), Number(c.req.query('limit') || 20));
    return c.json({ reports });
  } catch (err) {
    return fail(c, err, 'List');
  }
});

debugReports.get('/debug/reports/:id', async (c) => {
  try {
    const { row, report } = await loadDebugReport(c.env, c.get('user').id, c.req.param('id'));
    const num = (k: string) => (c.req.query(k) != null ? Number(c.req.query(k)) : undefined);
    const data = sliceDebugReport(report, {
      section: c.req.query('section'),
      offset: num('offset'),
      limit: num('limit'),
      deck_id: c.req.query('deck_id'),
      queue: c.req.query('queue'),
      in_due_queue: c.req.query('in_due_queue'),
      card_id: c.req.query('card_id'),
    });
    return c.json({ meta: row, ...data });
  } catch (err) {
    return fail(c, err, 'Read');
  }
});

debugReports.get('/debug/compare', async (c) => {
  try {
    const maxCards = c.req.query('max_cards');
    const comparison = await compareStoredReports(c.env, c.get('user').id, {
      a: c.req.query('a'),
      b: c.req.query('b'),
      maxCards: maxCards ? Math.max(0, Math.min(500, Number(maxCards) || 0)) : undefined,
      withServer: c.req.query('server') !== '0',
    });
    return c.json(comparison);
  } catch (err) {
    return fail(c, err, 'Compare');
  }
});

debugReports.post('/debug/crash', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const result = await storeCrashes(c.env.DB, c.get('user').id, body);
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result, 201);
  } catch (err) {
    return fail(c, err, 'Crash upload');
  }
});

debugReports.get('/debug/crashes', async (c) => {
  try {
    const traceChars = c.req.query('trace_chars');
    const crashes = await listCrashes(c.env.DB, c.get('user').id, {
      client: c.req.query('client'),
      limit: Number(c.req.query('limit') || 20),
      traceChars: traceChars != null ? Number(traceChars) : undefined,
    });
    return c.json({ crashes });
  } catch (err) {
    return fail(c, err, 'Crash list');
  }
});

export default debugReports;
