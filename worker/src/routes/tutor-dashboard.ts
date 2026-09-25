/**
 * Tutor dashboard routes. Mounted under /api in index.ts after the auth
 * middleware, so c.get('user') is always set here.
 *
 *   GET  /tutor/dashboard?tz_offset=               every student card + pending invites + homework decks
 *   GET  /relationships/:relId/overview?tz_offset= one student card (the student page)
 *   POST /relationships/:relId/conversations/open  most recent conversation, created if none
 *   POST /relationships/:relId/send-howto          chat message with the install steps
 *   POST /relationships/:relId/shared-decks/:id/update  bring the student's copy up to date
 *   POST /relationships/:relId/shared-decks/:id/move    move the student's copy in their study queue
 *   POST /me/client-state                          the device reports install kind + cached audio
 */

import { Hono } from 'hono';
import type { Env, TutorRelationship } from '../types';
import {
  verifyRelationshipAccess,
  getMyRole,
  getOtherUserId,
  getMyRelationships,
  updateSharedDeckCopy,
} from '../services/relationships';
import { createConversation, sendMessage } from '../services/conversations';
import { resolveFrontendUrl } from '../services/auth';
import { listInvitesByUser } from '../db/invite-queries';
import { fetchReviewRows, fetchRecordingMarks } from '../db/insights-queries';
import * as q from '../db/tutor-dashboard-queries';
import { buildStudentOverview, parseTzOffset, type StudentOverview } from '../services/tutor-dashboard';
import { moveDeckInQueue } from '../services/content';
import { isQueueMove } from '@shared/decks';
import { countOpenCardFlags } from '../services/card-flags';

const tutorDashboard = new Hono<{ Bindings: Env }>();

class HttpError extends Error {
  constructor(public status: 400 | 403 | 404, message: string) {
    super(message);
  }
}

async function requireTutor(db: D1Database, relId: string, userId: string): Promise<{ rel: TutorRelationship; studentId: string }> {
  let rel: TutorRelationship;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HttpError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') {
    throw new HttpError(403, 'Only the tutor can view this');
  }
  return { rel, studentId: getOtherUserId(rel, userId) };
}

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : fallback;
  console.error('[tutor-dashboard]', message);
  return c.json({ error: message }, 500);
}

const DAY_MS = 86_400_000;

async function loadOverview(
  db: D1Database,
  rel: TutorRelationship,
  tutorId: string,
  studentId: string,
  frontendUrl: string,
  tzOffset: number
): Promise<StudentOverview | null> {
  const now = new Date();
  const from30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const from7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const nowIso = now.toISOString();

  const [student, activityRows, weekRows, weekMarks, unheard, totals, decks, lessons, audioTotal, invite, lastConversationId, deckQueue, openFlags] =
    await Promise.all([
      q.fetchStudentUserRow(db, studentId),
      q.fetchActivityRows(db, studentId, from30),
      fetchReviewRows(db, studentId, from7, nowIso),
      fetchRecordingMarks(db, studentId, from7, nowIso),
      q.countUnheardRecordings(db, studentId),
      q.fetchReviewTotals(db, studentId),
      q.fetchHomeworkDecks(db, rel.id),
      q.fetchHomeworkLessons(db, rel.id, tutorId, studentId),
      q.countStudentAudioClips(db, studentId),
      q.fetchRedeemedInvite(db, tutorId, studentId, frontendUrl),
      q.fetchLastConversationId(db, rel.id),
      q.fetchStudentDeckQueue(db, studentId),
      countOpenCardFlags(db, rel.id),
    ]);
  if (!student) return null;

  return buildStudentOverview({
    relationship_id: rel.id,
    student,
    joined_at: rel.accepted_at || rel.created_at,
    activity_rows: activityRows,
    week_rows: weekRows,
    week_marks: weekMarks,
    unheard_recordings: unheard,
    open_flags: openFlags,
    first_review_at: totals.first_review_at,
    total_reviews: totals.total,
    homework_decks: decks,
    homework_lessons: lessons,
    deck_queue: deckQueue,
    audio_total: audioTotal,
    invite,
    last_conversation_id: lastConversationId,
    tz_offset_minutes: tzOffset,
    now,
  });
}

// ============ Dashboard ============

tutorDashboard.get('/tutor/dashboard', async (c) => {
  try {
    const user = c.get('user');
    const tzOffset = parseTzOffset(c.req.query('tz_offset'));
    const frontendUrl = resolveFrontendUrl(c.req.raw);
    const mine = await getMyRelationships(c.env.DB, user.id);

    const students = (
      await Promise.all(
        mine.students.map((rel) => loadOverview(c.env.DB, rel, user.id, getOtherUserId(rel, user.id), frontendUrl, tzOffset))
      )
    ).filter((s): s is StudentOverview => !!s);

    // Students who need a nudge first, then by most recent activity.
    students.sort((a, b) => {
      if (a.is_new !== b.is_new) return a.is_new ? 1 : -1;
      return (b.status.last_studied_at ?? '').localeCompare(a.status.last_studied_at ?? '');
    });

    const canInvite = !!user.can_invite || !!user.is_admin;
    const invites = canInvite ? await listInvitesByUser(c.env.DB, user.id) : [];
    const pending = invites
      .filter((i) => i.status === 'active' && i.use_count === 0)
      .map((i) => ({
        id: i.id,
        url: `${frontendUrl}/join/${i.id}`,
        email: i.email,
        inviter_role: i.inviter_role,
        created_at: i.created_at,
        expires_at: i.expires_at,
        note: i.note,
        share_deck_count: (() => {
          try {
            return i.share_deck_ids ? (JSON.parse(i.share_deck_ids) as unknown[]).length : 0;
          } catch {
            return 0;
          }
        })(),
        // Another change adds invites.opened_at; read it when present.
        opened_at: (i as { opened_at?: string | null }).opened_at ?? null,
      }));

    const homework_decks = await q.fetchTutorHomeworkDecks(c.env.DB, user.id);

    return c.json({
      students,
      invites: pending,
      homework_decks,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the dashboard');
  }
});

// ============ One student ============

tutorDashboard.get('/relationships/:relId/overview', async (c) => {
  try {
    const user = c.get('user');
    const { rel, studentId } = await requireTutor(c.env.DB, c.req.param('relId'), user.id);
    const overview = await loadOverview(
      c.env.DB,
      rel,
      user.id,
      studentId,
      resolveFrontendUrl(c.req.raw),
      parseTzOffset(c.req.query('tz_offset'))
    );
    if (!overview) throw new HttpError(404, 'Student not found');
    return c.json(overview);
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the student overview');
  }
});

// ============ Message: open the most recent conversation ============

tutorDashboard.post('/relationships/:relId/conversations/open', async (c) => {
  try {
    const user = c.get('user');
    const relId = c.req.param('relId');
    try {
      await verifyRelationshipAccess(c.env.DB, relId, user.id);
    } catch {
      throw new HttpError(404, 'Relationship not found or not active');
    }
    const existing = await q.fetchLastConversationId(c.env.DB, relId);
    if (existing) return c.json({ conversation_id: existing, created: false });
    const conv = await createConversation(c.env.DB, relId, user.id, {});
    return c.json({ conversation_id: conv.id, created: true }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to open the conversation');
  }
});

// ============ Send how-to ============

export function installHowToMessage(studentName: string | null, appUrl: string): string {
  const hi = studentName ? `Hi ${studentName}! ` : 'Hi! ';
  return (
    `${hi}Here is how to get the app on your phone so it works offline (on the train, on a plane):\n\n` +
    `Android app (recommended):\n` +
    `1. Install Obtainium from the Play Store or https://github.com/ImranR98/Obtainium\n` +
    `2. In Obtainium tap "Add App" and paste https://github.com/jerome3o/claude-for-language\n` +
    `3. Install the app it finds, open it and sign in with Google once.\n\n` +
    `Or add a home-screen shortcut: open ${appUrl} in Chrome, tap the ⋮ menu → "Add to Home screen" / "Install app".\n\n` +
    `Once it is installed, open it while you have internet so your words and audio download. After that it works without a connection.`
  );
}

tutorDashboard.post('/relationships/:relId/send-howto', async (c) => {
  try {
    const user = c.get('user');
    const relId = c.req.param('relId');
    const { studentId } = await requireTutor(c.env.DB, relId, user.id);
    const student = await q.fetchStudentUserRow(c.env.DB, studentId);
    let conversationId = await q.fetchLastConversationId(c.env.DB, relId);
    if (!conversationId) {
      conversationId = (await createConversation(c.env.DB, relId, user.id, {})).id;
    }
    const message = await sendMessage(
      c.env.DB,
      conversationId,
      user.id,
      installHowToMessage(student?.name ?? null, resolveFrontendUrl(c.req.raw))
    );
    return c.json({ conversation_id: conversationId, message }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to send the how-to');
  }
});

// ============ Shared deck: update the student's copy ============

tutorDashboard.post('/relationships/:relId/shared-decks/:id/update', async (c) => {
  try {
    const user = c.get('user');
    const result = await updateSharedDeckCopy(c.env.DB, c.req.param('relId'), user.id, c.req.param('id'));
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update the shared deck';
    return c.json({ error: message }, 400);
  }
});

// Move the student's copy of a homework deck within THEIR study queue. The
// same move the student has on the Decks tab; the updated_at bump carries
// the new order to their device on the next sync.
tutorDashboard.post('/relationships/:relId/shared-decks/:id/move', async (c) => {
  try {
    const user = c.get('user');
    const { studentId } = await requireTutor(c.env.DB, c.req.param('relId'), user.id);
    const body = await c.req.json<{ to?: unknown }>().catch(() => ({} as { to?: unknown }));
    if (!isQueueMove(body.to)) throw new HttpError(400, "to must be 'top', 'up', 'down' or 'bottom'");
    const share = await q.fetchSharedDeck(c.env.DB, c.req.param('id'), c.req.param('relId'));
    if (!share) throw new HttpError(404, 'Shared deck not found');
    const moved = await moveDeckInQueue(c.env.DB, studentId, share.target_deck_id, body.to);
    if (!moved) throw new HttpError(404, 'The student no longer has this deck');
    return c.json({
      shared_deck_id: share.id,
      target_deck_id: share.target_deck_id,
      queue_position: moved.position,
      queue_total: moved.total,
    });
  } catch (error) {
    return errorResponse(c, error, 'Failed to move the deck');
  }
});

// ============ Client state report ============

const INSTALL_KINDS = new Set(['pwa', 'android', 'browser']);

tutorDashboard.post('/me/client-state', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req
      .json<{ install_kind?: unknown; cached_audio_count?: unknown }>()
      .catch(() => ({} as { install_kind?: unknown; cached_audio_count?: unknown }));
    const install_kind =
      typeof body.install_kind === 'string' && INSTALL_KINDS.has(body.install_kind)
        ? (body.install_kind as 'pwa' | 'android' | 'browser')
        : null;
    const cached_audio_count =
      typeof body.cached_audio_count === 'number' && Number.isFinite(body.cached_audio_count)
        ? Math.max(0, Math.round(body.cached_audio_count))
        : null;
    await q.recordClientState(c.env.DB, user.id, { install_kind, cached_audio_count });
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to record client state');
  }
});

export default tutorDashboard;
