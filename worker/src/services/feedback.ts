/**
 * In-app feedback (docs/FEEDBACK.md): `POST /api/feedback` stores what someone sent from the web's
 * Send feedback sheet, the Lab app's shake sheet or the VR front end as a `feature_requests` row
 * (kind feedback | bug, migration 0142) — so the admin page, Settings → Feature requests and the
 * MCP feature-request tools see it like any other request.
 *
 * - Idempotent by (user, client_id): a device's retry after a lost response returns the same row
 *   (200) and stores nothing twice.
 * - A screenshot (PNG / JPEG / WebP by its bytes, ≤ 4 MB) goes to R2 `feedback/<user>/<id>.<ext>`:
 *   person-made, private — served by `/api/audio/<key>` only to the author and admins
 *   (services/media-access.ts), never collected (storage-cleanup.ts).
 * - The context is filtered by `pickFeedbackContext` (shared/feedback): diagnostic fields only.
 * - Approval follows the feature-request rule: an admin's feedback with a message is approved at once
 *   (and starts the Claude Code routine when configured); everything else waits for an admin.
 *   Someone other than an admin → one ntfy ping.
 * - At most FEEDBACK_PER_HOUR items an hour per account (429 + retry_after).
 */
import type { Env, User } from '../types';
import {
  FEEDBACK_MAX_CONSOLE_LOGS,
  FEEDBACK_MAX_MESSAGE,
  FEEDBACK_MAX_SCREENSHOT_BYTES,
  FEEDBACK_PER_HOUR,
  feedbackContent,
  feedbackContextLine,
  isFeedbackKind,
  pickFeedbackContext,
  routePattern,
  type FeedbackContext,
  type FeedbackKind,
} from '@shared/feedback';
import { sniffImage } from './picture-hunt';
import { notifyFeedback } from './notifications';
import { fireFeatureRequestRoutine } from './feature-requests';

export const FEEDBACK_PREFIX = 'feedback/';
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const KEY = /^feedback\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9-]{1,64}\.(png|jpg|webp)$/;

export function isFeedbackScreenshotKey(key: string): boolean {
  return KEY.test(key);
}

export interface FeedbackInput {
  message: string;
  kind?: unknown;
  clientId?: string | null;
  context?: unknown;
  consoleLogs?: string | null;
  screenshot?: ArrayBuffer | null;
}

export interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  status: string;
  approval_status: string;
  created_at: string;
  client_id: string | null;
  has_screenshot: boolean;
}

export type FeedbackOutcome =
  | { ok: true; created: boolean; feedback: FeedbackRow }
  | { ok: false; status: 400 | 413 | 415 | 429; error: string; problems?: string[]; retry_after?: number };

export interface FeedbackDeps {
  now?: () => number;
  newId?: () => string;
  /** Background work (the routine, the ntfy ping). */
  waitUntil?: (p: Promise<unknown>) => void;
  notify?: typeof notifyFeedback;
  fireRoutine?: typeof fireFeatureRequestRoutine;
}

type FeedbackEnv = Pick<Env, 'DB' | 'AUDIO_BUCKET' | 'NTFY_TOPIC' | 'CCR_FEATURE_REQUEST_ROUTINE_URL' | 'CCR_FEATURE_REQUEST_ROUTINE_KEY'>;

interface StoredRow {
  id: string;
  kind: string;
  status: string;
  approval_status: string;
  created_at: string;
  client_id: string | null;
  screenshot_key: string | null;
}

function shape(r: StoredRow): FeedbackRow {
  return {
    id: r.id,
    kind: isFeedbackKind(r.kind) ? r.kind : 'feedback',
    status: r.status,
    approval_status: r.approval_status,
    created_at: r.created_at,
    client_id: r.client_id,
    has_screenshot: !!r.screenshot_key,
  };
}

async function existing(db: D1Database, userId: string, clientId: string): Promise<StoredRow | null> {
  return db
    .prepare('SELECT id, kind, status, approval_status, created_at, client_id, screenshot_key FROM feature_requests WHERE user_id = ? AND client_id = ?')
    .bind(userId, clientId)
    .first<StoredRow>();
}

const EXT: Record<string, 'png' | 'jpg' | 'webp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function createFeedback(
  env: FeedbackEnv,
  user: Pick<User, 'id' | 'is_admin' | 'name' | 'email'>,
  input: FeedbackInput,
  deps: FeedbackDeps = {},
): Promise<FeedbackOutcome> {
  const now = deps.now ?? Date.now;
  const clientId = typeof input.clientId === 'string' && CLIENT_ID.test(input.clientId) ? input.clientId : null;
  if (clientId) {
    const row = await existing(env.DB, user.id, clientId);
    if (row) return { ok: true, created: false, feedback: shape(row) };
  }

  const message = typeof input.message === 'string' ? input.message.replace(/\r\n/g, '\n').trim() : '';
  if (message.length > FEEDBACK_MAX_MESSAGE) return { ok: false, status: 400, error: `Keep it under ${FEEDBACK_MAX_MESSAGE} characters`, problems: ['too_long'] };
  if (input.kind !== undefined && input.kind !== null && input.kind !== '' && !isFeedbackKind(input.kind)) {
    return { ok: false, status: 400, error: 'kind must be feedback or bug', problems: ['kind'] };
  }
  const kind: FeedbackKind = isFeedbackKind(input.kind) ? input.kind : 'feedback';

  let shot: { bytes: ArrayBuffer; mime: string } | null = null;
  if (input.screenshot && input.screenshot.byteLength > 0) {
    if (input.screenshot.byteLength > FEEDBACK_MAX_SCREENSHOT_BYTES) return { ok: false, status: 413, error: 'The screenshot is too big (4 MB at most)', problems: ['screenshot_too_big'] };
    const sniffed = sniffImage(new Uint8Array(input.screenshot.slice(0, 64 * 1024)));
    if (!sniffed || !EXT[sniffed.mime]) return { ok: false, status: 415, error: 'The screenshot must be a PNG, JPEG or WebP picture', problems: ['screenshot_type'] };
    shot = { bytes: input.screenshot, mime: sniffed.mime };
  }
  if (!message && !shot) return { ok: false, status: 400, error: 'Write a message or attach a screenshot', problems: ['empty'] };

  const hourAgo = new Date(now() - 3600_000).toISOString();
  const recent = await env.DB
    .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM feature_requests WHERE user_id = ? AND kind IN ('feedback', 'bug') AND created_at > ?")
    .bind(user.id, hourAgo)
    .first<{ n: number; oldest: string | null }>();
  if ((recent?.n ?? 0) >= FEEDBACK_PER_HOUR) {
    const oldest = recent?.oldest ? Date.parse(recent.oldest) : now();
    const retry = Math.max(60, Math.ceil((oldest + 3600_000 - now()) / 1000));
    return { ok: false, status: 429, error: "That's a lot of feedback in an hour — please wait a little before sending more.", retry_after: retry };
  }

  const context: FeedbackContext = pickFeedbackContext(input.context);
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const createdAt = new Date(now()).toISOString();
  const key = shot ? `${FEEDBACK_PREFIX}${user.id}/${id}.${EXT[shot.mime]}` : null;
  if (shot && key) await env.AUDIO_BUCKET.put(key, shot.bytes, { httpMetadata: { contentType: shot.mime } });

  const approval = user.is_admin && message ? 'approved' : 'pending';
  const contextLine = feedbackContextLine(context);
  const pageContext = contextLine || (context.screen ? routePattern(context.screen) : null);
  const logs = typeof input.consoleLogs === 'string' && input.consoleLogs.trim() ? input.consoleLogs.slice(-FEEDBACK_MAX_CONSOLE_LOGS) : null;
  const res = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO feature_requests
         (id, user_id, content, page_context, console_logs, screenshot_url, screenshot_key, status, approval_status, kind, client_id, context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      feedbackContent(message, !!shot, kind),
      pageContext,
      logs,
      key ? `/api/audio/${key}` : null,
      key,
      approval,
      kind,
      clientId,
      JSON.stringify(context),
      createdAt,
      createdAt,
    )
    .run();

  if ((res.meta?.changes ?? 0) === 0 && clientId) {
    // Lost a race with the same item from the same device: keep the first, drop our copy.
    if (key) await env.AUDIO_BUCKET.delete(key).catch(() => {});
    const row = await existing(env.DB, user.id, clientId);
    if (row) return { ok: true, created: false, feedback: shape(row) };
  }

  const waitUntil = deps.waitUntil ?? ((p: Promise<unknown>) => void p.catch(() => {}));
  if (approval === 'approved') waitUntil((deps.fireRoutine ?? fireFeatureRequestRoutine)(env, id, null));
  if (!user.is_admin && env.NTFY_TOPIC) {
    waitUntil(
      (deps.notify ?? notifyFeedback)(env.NTFY_TOPIC, {
        name: user.name || 'Someone',
        kind,
        preview: message ? message.slice(0, 140) : '(screenshot only)',
        screenshot: !!shot,
      }),
    );
  }

  return {
    ok: true,
    created: true,
    feedback: { id, kind, status: 'new', approval_status: approval, created_at: createdAt, client_id: clientId, has_screenshot: !!shot },
  };
}

/** A feature_requests row for a response: `context` parsed (and re-filtered), its one-line summary. */
export function shapeFeatureRequest<T extends Record<string, unknown>>(row: T): T & { kind: string; context: FeedbackContext | null; context_line: string | null } {
  let context: FeedbackContext | null = null;
  if (typeof row.context === 'string' && row.context) {
    try {
      context = pickFeedbackContext(JSON.parse(row.context));
    } catch {
      context = null;
    }
  }
  return {
    ...row,
    kind: typeof row.kind === 'string' ? row.kind : 'request',
    context,
    context_line: context ? feedbackContextLine(context) || null : null,
  };
}
