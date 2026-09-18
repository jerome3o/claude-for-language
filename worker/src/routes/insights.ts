/**
 * Tutor "Student Insights" routes. Mounted under /api in index.ts after the
 * auth middleware, so c.get('user') is always set here.
 *
 *   GET    /relationships/:relId/lesson-log
 *   POST   /relationships/:relId/lesson-log
 *   DELETE /relationships/:relId/lesson-log/:id
 *   GET    /relationships/:relId/insights?from&to
 *   POST   /relationships/:relId/insights/summary {from,to}
 *   GET    /relationships/:relId/insights/summaries
 *   PUT    /relationships/:relId/recordings/:eventId/mark {status,comment?}
 *   DELETE /relationships/:relId/recordings/:eventId/mark
 *   GET    /relationships/:relId/history?from&to&deck_id&card_type&rating&q&cursor&limit
 *
 * All of them are tutor-only.
 */

import { Hono } from 'hono';
import type { Env, CardType, TutorRelationship } from '../types';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';
import { computeInsights, resolveRange, endOfDayIfBare } from '../services/insights';
import { writeStudentSummary } from '../services/insights-summary';
import * as q from '../db/insights-queries';

const insights = new Hono<{ Bindings: Env }>();

class HttpError extends Error {
  constructor(public status: 400 | 403 | 404 | 503, message: string) {
    super(message);
  }
}

async function requireTutor(
  db: D1Database,
  relId: string,
  userId: string
): Promise<{ rel: TutorRelationship; studentId: string }> {
  let rel: TutorRelationship;
  try {
    rel = await verifyRelationshipAccess(db, relId, userId);
  } catch {
    throw new HttpError(404, 'Relationship not found or not active');
  }
  if (getMyRole(rel, userId) !== 'tutor') {
    throw new HttpError(403, 'Only the tutor can view student insights');
  }
  return { rel, studentId: getOtherUserId(rel, userId) };
}

async function getUserName(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT name, email FROM users WHERE id = ?`).bind(userId).first<{ name: string | null; email: string | null }>();
  return row?.name || row?.email || null;
}

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : fallback;
  console.error('[insights]', message);
  return c.json({ error: message }, 500);
}

const CARD_TYPES: CardType[] = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

// ============ Lesson log ============

insights.get('/relationships/:relId/lesson-log', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const entries = await q.listLessonLog(c.env.DB, relId);
    return c.json({ entries });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load lesson log');
  }
});

insights.post('/relationships/:relId/lesson-log', async (c) => {
  try {
    const relId = c.req.param('relId');
    const tutor = c.get('user');
    const { studentId } = await requireTutor(c.env.DB, relId, tutor.id);
    const body = await c.req.json<{ lesson_at?: string; notes?: string }>().catch(() => ({} as { lesson_at?: string; notes?: string }));

    let lessonAt = body.lesson_at?.trim();
    if (!lessonAt) lessonAt = new Date().toISOString();
    else if (/^\d{4}-\d{2}-\d{2}$/.test(lessonAt)) lessonAt = `${lessonAt}T12:00:00.000Z`;
    if (isNaN(new Date(lessonAt).getTime())) throw new HttpError(400, 'lesson_at must be an ISO date');
    lessonAt = new Date(lessonAt).toISOString();

    const notes = body.notes?.trim() || null;
    const entry = await q.createLessonLogEntry(c.env.DB, {
      relationship_id: relId,
      tutor_id: tutor.id,
      student_id: studentId,
      lesson_at: lessonAt,
      notes,
    });

    // Non-empty notes also land in the student's Lesson Notes so they feed the
    // daily reader and the other AI helpers automatically.
    let student_lesson_note_id: string | null = null;
    if (notes) {
      const tutorName = tutor.name || tutor.email || 'your tutor';
      const date = lessonAt.slice(0, 10);
      student_lesson_note_id = await q.createStudentLessonNote(
        c.env.DB,
        studentId,
        `[From tutor ${tutorName}, ${date}]\n${notes}`,
        date
      );
    }

    return c.json({ entry, student_lesson_note_id }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to log lesson');
  }
});

insights.delete('/relationships/:relId/lesson-log/:id', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const ok = await q.deleteLessonLogEntry(c.env.DB, relId, c.req.param('id'));
    if (!ok) throw new HttpError(404, 'Lesson not found');
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to delete lesson');
  }
});

// ============ Insights report ============

async function loadReport(db: D1Database, relId: string, studentId: string, params: { from?: string | null; to?: string | null }) {
  const latest = await q.getLatestLessonAt(db, relId);
  const range = resolveRange({ from: params.from, to: endOfDayIfBare(params.to) }, latest?.lesson_at ?? null);
  const [rows, cardStates, newWordsIntroduced, activity, marks] = await Promise.all([
    q.fetchReviewRows(db, studentId, range.from, range.to),
    q.fetchCardStatesForRange(db, studentId, range.from, range.to),
    q.countNewWordsIntroduced(db, studentId, range.from, range.to),
    q.fetchActivity(db, studentId, range.from, range.to),
    q.fetchRecordingMarks(db, studentId, range.from, range.to),
  ]);
  const report = computeInsights({ rows, cardStates, newWordsIntroduced, activity, marks });
  return {
    report,
    range: { from: range.from, to: range.to },
    since_lesson: range.used_since_lesson && latest ? { id: latest.id, lesson_at: latest.lesson_at } : null,
    latest_lesson: latest ? { id: latest.id, lesson_at: latest.lesson_at } : null,
  };
}

insights.get('/relationships/:relId/insights', async (c) => {
  try {
    const relId = c.req.param('relId');
    const { studentId } = await requireTutor(c.env.DB, relId, c.get('user').id);
    const { report, range, since_lesson, latest_lesson } = await loadReport(c.env.DB, relId, studentId, {
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    return c.json({ range, since_lesson, latest_lesson, ...report });
  } catch (error) {
    return errorResponse(c, error, 'Failed to compute insights');
  }
});

// ============ Narrative summary ============

insights.post('/relationships/:relId/insights/summary', async (c) => {
  try {
    const relId = c.req.param('relId');
    const { studentId } = await requireTutor(c.env.DB, relId, c.get('user').id);
    if (!c.env.ANTHROPIC_API_KEY) {
      throw new HttpError(503, 'AI summaries are not configured on this server (missing ANTHROPIC_API_KEY)');
    }
    const body = await c.req.json<{ from?: string; to?: string }>().catch(() => ({} as { from?: string; to?: string }));
    const { report, range } = await loadReport(c.env.DB, relId, studentId, { from: body.from, to: endOfDayIfBare(body.to) });
    if (report.totals.reviews === 0) {
      throw new HttpError(400, 'No study activity in this period to summarize');
    }
    const studentName = await getUserName(c.env.DB, studentId);
    const narrative = await writeStudentSummary(c.env.ANTHROPIC_API_KEY, report, range, studentName);
    const { recordings: _recordings, ...statsForStorage } = report;
    const summary = await q.createStudentSummary(c.env.DB, {
      relationship_id: relId,
      range_from: range.from,
      range_to: range.to,
      narrative_en: narrative.narrative_en,
      narrative_zh: narrative.narrative_zh,
      stats_json: JSON.stringify({
        totals: statsForStorage.totals,
        struggling: statsForStorage.struggling.slice(0, 12).map(({ events: _e, ...s }) => s),
        going_well: statsForStorage.going_well.slice(0, 12),
      }),
    });
    return c.json({ summary }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to write summary');
  }
});

insights.get('/relationships/:relId/insights/summaries', async (c) => {
  try {
    const relId = c.req.param('relId');
    await requireTutor(c.env.DB, relId, c.get('user').id);
    const summaries = await q.listStudentSummaries(c.env.DB, relId);
    return c.json({ summaries });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load summaries');
  }
});

// ============ Recording marks ============

insights.put('/relationships/:relId/recordings/:eventId/mark', async (c) => {
  try {
    const relId = c.req.param('relId');
    const eventId = c.req.param('eventId');
    const tutor = c.get('user');
    const { studentId } = await requireTutor(c.env.DB, relId, tutor.id);
    const owner = await q.getReviewEventOwner(c.env.DB, eventId);
    if (!owner || owner.user_id !== studentId) throw new HttpError(404, 'Recording not found');
    const body = await c.req.json<{ status?: string; comment?: string | null }>().catch(() => ({} as { status?: string; comment?: string | null }));
    if (body.status !== 'listened' && body.status !== 'needs_work') {
      throw new HttpError(400, "status must be 'listened' or 'needs_work'");
    }
    const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 2000) : null;
    const mark = await q.upsertRecordingMark(c.env.DB, {
      review_event_id: eventId,
      tutor_id: tutor.id,
      status: body.status,
      comment,
    });
    return c.json({ mark });
  } catch (error) {
    return errorResponse(c, error, 'Failed to save mark');
  }
});

insights.delete('/relationships/:relId/recordings/:eventId/mark', async (c) => {
  try {
    const relId = c.req.param('relId');
    const eventId = c.req.param('eventId');
    const { studentId } = await requireTutor(c.env.DB, relId, c.get('user').id);
    const owner = await q.getReviewEventOwner(c.env.DB, eventId);
    if (!owner || owner.user_id !== studentId) throw new HttpError(404, 'Recording not found');
    await q.deleteRecordingMark(c.env.DB, eventId);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to clear mark');
  }
});

// ============ History explorer ============

insights.get('/relationships/:relId/history', async (c) => {
  try {
    const relId = c.req.param('relId');
    const { studentId } = await requireTutor(c.env.DB, relId, c.get('user').id);
    const latest = await q.getLatestLessonAt(c.env.DB, relId);
    const range = resolveRange({ from: c.req.query('from'), to: endOfDayIfBare(c.req.query('to')) }, latest?.lesson_at ?? null);

    const cardTypeParam = c.req.query('card_type');
    const card_type = CARD_TYPES.includes(cardTypeParam as CardType) ? (cardTypeParam as CardType) : null;
    const ratingParam = c.req.query('rating');
    const rating = ratingParam != null && ratingParam !== '' && /^[0-3]$/.test(ratingParam) ? Number(ratingParam) : null;
    const limitParam = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(limitParam) ? limitParam : 100;

    const [page, decks] = await Promise.all([
      q.fetchHistoryPage(c.env.DB, studentId, {
        from: range.from,
        to: range.to,
        deck_id: c.req.query('deck_id') || null,
        card_type,
        rating,
        q: c.req.query('q') || null,
        cursor: c.req.query('cursor') || null,
        limit,
      }),
      c.req.query('cursor') ? Promise.resolve(null) : q.fetchStudentDecks(c.env.DB, studentId),
    ]);

    return c.json({
      range: { from: range.from, to: range.to },
      events: page.events,
      next_cursor: page.next_cursor,
      ...(decks ? { decks } : {}),
    });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load history');
  }
});

export default insights;
