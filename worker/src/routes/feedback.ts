/**
 * In-app feedback (docs/FEEDBACK.md, services/feedback.ts):
 *
 *   POST /api/feedback   multipart/form-data  message?, kind? (feedback | bug), client_id?, context? (JSON
 *                        string), console_logs?, screenshot? (PNG / JPEG / WebP file, ≤ 4 MB)
 *                        — or application/json { message?, kind?, client_id?, context?, console_logs? } (no screenshot)
 *                        → 201 { feedback, created: true } · 200 { feedback, created: false } (same client_id again)
 *                        · 400 { error, problems } · 413 / 415 (screenshot) · 429 { error, retry_after } + Retry-After
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { createFeedback, type FeedbackInput } from '../services/feedback';

const feedbackRoutes = new Hono<{ Bindings: Env }>();

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function readInput(req: Request): Promise<FeedbackInput | { error: string }> {
  const type = req.headers.get('Content-Type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) return { error: 'Could not read the form' };
    let context: unknown;
    const rawContext = form.get('context');
    if (typeof rawContext === 'string' && rawContext) {
      try {
        context = JSON.parse(rawContext);
      } catch {
        context = undefined;
      }
    }
    const file = form.get('screenshot') as unknown;
    let screenshot: ArrayBuffer | null = null;
    if (file && typeof file === 'object' && 'arrayBuffer' in file) screenshot = await (file as Blob).arrayBuffer();
    return {
      message: str(form.get('message')) ?? '',
      kind: str(form.get('kind')),
      clientId: str(form.get('client_id')) ?? null,
      context,
      consoleLogs: str(form.get('console_logs')) ?? null,
      screenshot,
    };
  }
  const body = await req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') return { error: 'Send multipart/form-data or JSON' };
  return {
    message: str(body.message) ?? '',
    kind: body.kind,
    clientId: str(body.client_id) ?? null,
    context: body.context,
    consoleLogs: str(body.console_logs) ?? null,
    screenshot: null,
  };
}

feedbackRoutes.post('/feedback', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const input = await readInput(c.req.raw);
  if ('error' in input) return c.json({ error: input.error }, 400);
  const out = await createFeedback(c.env, user, input, {
    waitUntil: (p) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        void p.catch(() => {});
      }
    },
  });
  if (!out.ok) {
    const headers: Record<string, string> = {};
    if (out.retry_after) headers['Retry-After'] = String(out.retry_after);
    return c.json({ error: out.error, problems: out.problems, retry_after: out.retry_after }, out.status, headers);
  }
  return c.json({ feedback: out.feedback, created: out.created }, out.created ? 201 : 200);
});

export default feedbackRoutes;
