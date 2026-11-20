/**
 * "Example sentence style" (services/sentence-style.ts, shared/study/sentenceStyle.ts). Mounted under /api after auth.
 *
 *   PUT /profile/sentence-style { sentence_style: 'standard' | 'everyday' | 'casual' | null } → { sentence_style, is_default }
 *
 * null = back to the default (everyday). `/api/auth/me` and `/api/sync/changes` carry the style in effect as
 * `sentence_style`. Only new example sentences follow it — stored ones are never rewritten.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { pickSentenceStyleUpdate } from '../../../shared/study/sentenceStyle';
import { setSentenceStyle } from '../services/sentence-style';

const sentenceStyle = new Hono<{ Bindings: Env }>();

sentenceStyle.put('/profile/sentence-style', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json().catch(() => ({}));
  const { value, problems } = pickSentenceStyleUpdate(body);
  if (problems.length > 0) return c.json({ error: problems[0], problems }, 400);
  const style = await setSentenceStyle(c.env.DB, userId, value);
  return c.json({ sentence_style: style, is_default: value === null });
});

export default sentenceStyle;
