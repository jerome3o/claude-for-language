/**
 * In-app feedback (docs/FEEDBACK.md, services/feedback.ts, routes/feedback.ts) against real SQLite
 * with every migration: a feedback item is a feature_requests row (kind feedback | bug), idempotent
 * by client id, with its screenshot in R2 `feedback/<user>/<id>.<ext>` served only to its author
 * and admins; the context is filtered; the hourly limit holds; approval + ntfy follow the rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { createFeedback, shapeFeatureRequest, isFeedbackScreenshotKey } from '../feedback';
import feedbackRoutes from '../../routes/feedback';
import { canAccessMedia } from '../media-access';
import { mediaAccessOf } from '@shared/media/access';
import { FEEDBACK_PER_HOUR } from '@shared/feedback';
import type { Env, User } from '../../types';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 4, 0, 4, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1]);

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; type?: string }>();
  const bucket = {
    put: vi.fn(async (key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { bytes, type: opts?.httpMetadata?.contentType });
    }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
    get: async (key: string) => (objects.has(key) ? ({ body: new Blob([objects.get(key)!.bytes]).stream(), size: 1, httpMetadata: { contentType: objects.get(key)!.type } } as unknown as R2ObjectBody) : null),
  };
  return { bucket: bucket as unknown as R2Bucket & typeof bucket, objects };
}

let db: SqliteD1;
let r2: ReturnType<typeof fakeBucket>;
const JEROME = { id: 'u-admin', is_admin: 1, name: 'Jerome', email: 'j@example.com' } as User;
const MINGHUI = { id: 'u-tutor', is_admin: 0, name: 'Minghui', email: 'm@example.com' } as User;
const STRANGER = { id: 'u-other', is_admin: 0, name: 'Other', email: 'o@example.com' } as User;

function env(topic = 'topic'): Env {
  return { DB: db, AUDIO_BUCKET: r2.bucket, NTFY_TOPIC: topic } as unknown as Env;
}

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = fakeBucket();
  for (const u of [JEROME, MINGHUI, STRANGER]) db.raw.run('INSERT INTO users (id, email, name, is_admin) VALUES (?, ?, ?, ?)', [u.id, u.email, u.name, u.is_admin]);
});

describe('createFeedback', () => {
  it('stores a feedback row with its screenshot, filtered context and the page line', async () => {
    const notify = vi.fn(async () => {});
    const out = await createFeedback(env(), MINGHUI, {
      message: 'The homework row froze',
      kind: 'bug',
      clientId: 'fb_client_0001',
      context: { platform: 'lab', app_version: '0.142', screen: '/homework/hw-12', device: 'Pixel 9', online: true, via: 'shake', token: 'nope', recent_events: ['homework.open', 'bad event'] },
      screenshot: PNG.buffer,
    }, { notify, newId: () => 'fb-1', waitUntil: (p) => void p });
    expect(out).toMatchObject({ ok: true, created: true, feedback: { id: 'fb-1', kind: 'bug', approval_status: 'pending', has_screenshot: true } });
    const [row] = db.rows<Record<string, string>>('SELECT * FROM feature_requests');
    expect(row.kind).toBe('bug');
    expect(row.screenshot_key).toBe('feedback/u-tutor/fb-1.png');
    expect(row.screenshot_url).toBe('/api/audio/feedback/u-tutor/fb-1.png');
    expect(row.page_context).toBe('Lab app 0.142 · /homework/:id · Pixel 9 · shaken');
    expect(JSON.parse(row.context)).toEqual({ platform: 'lab', app_version: '0.142', screen: '/homework/:id', device: 'Pixel 9', online: true, via: 'shake', recent_events: ['homework.open'] });
    expect(r2.objects.get('feedback/u-tutor/fb-1.png')?.type).toBe('image/png');
    expect(notify).toHaveBeenCalledWith('topic', expect.objectContaining({ name: 'Minghui', kind: 'bug', screenshot: true }));
    expect(isFeedbackScreenshotKey(row.screenshot_key)).toBe(true);
  });

  it('is idempotent by client id (nothing stored twice)', async () => {
    const first = await createFeedback(env(''), MINGHUI, { message: 'Hi', clientId: 'fb_client_0002', screenshot: JPEG.buffer });
    const again = await createFeedback(env(''), MINGHUI, { message: 'Hi', clientId: 'fb_client_0002', screenshot: JPEG.buffer });
    expect(first.ok && first.created).toBe(true);
    expect(again).toMatchObject({ ok: true, created: false });
    expect(again.ok && first.ok && again.feedback.id).toBe(first.ok && first.feedback.id);
    expect(db.rows('SELECT id FROM feature_requests')).toHaveLength(1);
    expect(r2.bucket.put).toHaveBeenCalledTimes(1);
    // Another account's same client id is its own item.
    const other = await createFeedback(env(''), STRANGER, { message: 'Hi', clientId: 'fb_client_0002' });
    expect(other.ok && other.created).toBe(true);
  });

  it('a screenshot alone is enough; nothing is not; bad pictures and long text are refused', async () => {
    const shotOnly = await createFeedback(env(''), MINGHUI, { message: '  ', screenshot: PNG.buffer });
    expect(shotOnly.ok).toBe(true);
    expect(db.rows<{ content: string }>('SELECT content FROM feature_requests')[0].content).toMatch(/screenshot only/i);
    expect(await createFeedback(env(''), MINGHUI, { message: '' })).toMatchObject({ ok: false, status: 400, problems: ['empty'] });
    expect(await createFeedback(env(''), MINGHUI, { message: 'x'.repeat(4001) })).toMatchObject({ ok: false, status: 400 });
    expect(await createFeedback(env(''), MINGHUI, { message: 'hi', screenshot: new TextEncoder().encode('<svg></svg>').buffer as ArrayBuffer })).toMatchObject({ ok: false, status: 415 });
    expect(await createFeedback(env(''), MINGHUI, { message: 'hi', screenshot: new ArrayBuffer(4 * 1024 * 1024 + 1) })).toMatchObject({ ok: false, status: 413 });
    expect(await createFeedback(env(''), MINGHUI, { message: 'hi', kind: 'rant' })).toMatchObject({ ok: false, status: 400, problems: ['kind'] });
  });

  it('an admin’s feedback with a message is approved (routine started) and pings nobody', async () => {
    const notify = vi.fn(async () => {});
    const fireRoutine = vi.fn(async () => 'skipped' as const);
    const out = await createFeedback(env(), JEROME, { message: 'Make the ⋯ menu bigger' }, { notify, fireRoutine, waitUntil: (p) => void p });
    expect(out.ok && out.feedback.approval_status).toBe('approved');
    expect(fireRoutine).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    const shot = await createFeedback(env(), JEROME, { message: '', screenshot: PNG.buffer }, { notify, fireRoutine, waitUntil: (p) => void p });
    expect(shot.ok && shot.feedback.approval_status).toBe('pending'); // nothing to act on yet
    expect(fireRoutine).toHaveBeenCalledTimes(1);
  });

  it('at most FEEDBACK_PER_HOUR an hour', async () => {
    let t = Date.parse('2026-10-25T10:00:00Z');
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++) {
      expect((await createFeedback(env(''), MINGHUI, { message: `n${i}` }, { now: () => (t += 1000) })).ok).toBe(true);
    }
    const refused = await createFeedback(env(''), MINGHUI, { message: 'one more' }, { now: () => t });
    expect(refused).toMatchObject({ ok: false, status: 429 });
    expect(refused.ok === false && refused.retry_after).toBeGreaterThan(0);
    // A retry of an item already accepted is still answered.
    t += 3600_000 + 60_000;
    expect((await createFeedback(env(''), MINGHUI, { message: 'later' }, { now: () => t })).ok).toBe(true);
  });
});

describe('POST /api/feedback', () => {
  function app(user: User | null) {
    const a = new Hono<{ Bindings: Env }>();
    a.use('*', async (c, next) => {
      if (user) c.set('user', user as never);
      await next();
    });
    a.route('/api', feedbackRoutes);
    return (init: RequestInit) => a.request('/api/feedback', { method: 'POST', ...init }, env(''));
  }

  it('takes multipart with a screenshot (201, then 200 for the same client id)', async () => {
    const form = () => {
      const f = new FormData();
      f.set('message', 'VR menu is too small');
      f.set('kind', 'feedback');
      f.set('client_id', 'vr_feedback_0001');
      f.set('context', JSON.stringify({ platform: 'vr', screen: '/vr', via: 'vr' }));
      f.set('screenshot', new Blob([PNG], { type: 'image/png' }), 'shot.png');
      return f;
    };
    const post = app(MINGHUI);
    const res = await post({ body: form() });
    expect(res.status).toBe(201);
    const body = await res.json<{ feedback: { id: string; has_screenshot: boolean }; created: boolean }>();
    expect(body.created).toBe(true);
    expect(body.feedback.has_screenshot).toBe(true);
    expect((await post({ body: form() })).status).toBe(200);
  });

  it('takes JSON without a screenshot; 400 when empty; 429 carries Retry-After', async () => {
    const post = app(MINGHUI);
    const json = (b: unknown) => post({ body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
    expect((await json({ message: 'Typing lag on the chat', context: { platform: 'web', screen: '/chats' } })).status).toBe(201);
    const empty = await json({ message: '' });
    expect(empty.status).toBe(400);
    expect((await empty.json<{ problems: string[] }>()).problems).toEqual(['empty']);
    for (let i = 1; i < FEEDBACK_PER_HOUR; i++) await json({ message: `m${i}` });
    const limited = await json({ message: 'too many' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('401 without a user', async () => {
    expect((await app(null)({ body: JSON.stringify({ message: 'x' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(401);
  });
});

describe('who sees a feedback screenshot', () => {
  it('the author and admins — nobody else', async () => {
    await createFeedback(env(''), MINGHUI, { message: 'x', screenshot: PNG.buffer }, { newId: () => 'fb-9' });
    const key = 'feedback/u-tutor/fb-9.png';
    expect(mediaAccessOf(key)).toBe('private');
    expect(await canAccessMedia(db, MINGHUI.id, key)).toBe(true);
    expect(await canAccessMedia(db, JEROME.id, `/api/audio/${key}`)).toBe(true);
    expect(await canAccessMedia(db, STRANGER.id, key)).toBe(false);
    expect(await canAccessMedia(db, JEROME.id, 'feedback/u-tutor/unknown.png')).toBe(false);
  });
});

describe('shapeFeatureRequest', () => {
  it('parses and re-filters the context; old rows read as requests', () => {
    const shaped = shapeFeatureRequest({ id: 'r', kind: 'bug', context: JSON.stringify({ platform: 'web', screen: '/decks/d-19', secret: 1 }) });
    expect(shaped.context).toEqual({ platform: 'web', screen: '/decks/:id' });
    expect(shaped.context_line).toBe('Web · /decks/:id');
    expect(shapeFeatureRequest({ id: 'old', context: null })).toMatchObject({ kind: 'request', context: null, context_line: null });
    expect(shapeFeatureRequest({ id: 'bad', kind: 'feedback', context: '{nope' }).context).toBeNull();
  });
});
