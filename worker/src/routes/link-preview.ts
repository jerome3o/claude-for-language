/**
 * GET /api/link-preview?url= → { url, title, description, image, site_name } — the
 * card under a chat message with a link (docs/CHAT.md "Round 2"). 400 for a URL
 * that may not be fetched, 404 when the page has nothing to show. Cached a day.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { fetchLinkPreview, safePreviewUrl } from '../services/link-preview';

const linkPreview = new Hono<{ Bindings: Env }>();

linkPreview.get('/link-preview', async (c) => {
  const raw = c.req.query('url') ?? '';
  if (raw.length > 2048 || !safePreviewUrl(raw)) return c.json({ error: 'This link can’t be previewed' }, 400);
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(`https://link-preview.internal/?u=${encodeURIComponent(raw)}`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) {
    const body = await hit.text();
    return body === 'null' ? c.json({ error: 'No preview' }, 404) : c.body(body, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' });
  }
  const preview = await fetchLinkPreview(raw);
  const body = JSON.stringify(preview);
  await cache
    ?.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${preview ? 86400 : 3600}` } }))
    .catch(() => {});
  if (!preview) return c.json({ error: 'No preview' }, 404);
  return c.body(body, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' });
});

export default linkPreview;
