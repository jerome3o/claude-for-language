/**
 * POST /api/me/pinyin-scan { apply?: boolean, kinds?: ('lesson' | 'library' | 'reader')[] }
 *
 * Scan the caller's stored lessons (and the copies they assigned), library lessons and readers for
 * impossible pinyin (services/pinyin-scan.ts). Dry run unless `apply: true`, which corrects it in
 * place (ids, history and schedules kept). Mounted under /api in index.ts. MCP: scan_content_pinyin.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { pinyinSources } from '../services/pinyin-check';
import { pickScanKinds, scanContentPinyin } from '../services/pinyin-scan';

const pinyinScan = new Hono<{ Bindings: Env }>();

pinyinScan.post('/me/pinyin-scan', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ apply?: unknown; kinds?: unknown }>().catch(() => ({} as { apply?: unknown; kinds?: unknown }));
  if (body.apply !== undefined && typeof body.apply !== 'boolean') return c.json({ error: 'apply must be true or false' }, 400);
  const kinds = pickScanKinds(body.kinds);
  if (!kinds) return c.json({ error: "kinds must be a non-empty list of 'lesson', 'library', 'reader'" }, 400);
  const result = await scanContentPinyin(c.env.DB, userId, { apply: body.apply === true, kinds, sources: pinyinSources(c.env) });
  if (result.apply && result.fix_count) console.log(`[pinyin-scan] corrected ${result.fix_count} line(s) in ${result.applied} item(s)`);
  return c.json(result);
});

export default pinyinScan;
