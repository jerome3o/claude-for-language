import { Hono } from 'hono';
import { Env, User } from '../types';
import { createSession } from '../services/auth';
import * as tutorJobs from '../db/tutor-notes-queries';
import * as insightsQ from '../db/insights-queries';

/**
 * Test authentication routes - ONLY enabled when E2E_TEST_MODE=true.
 *
 * These endpoints bypass Google OAuth for E2E testing purposes.
 * They should NEVER be enabled in production.
 */

const testAuth = new Hono<{ Bindings: Env }>();

// Middleware to check E2E test mode is enabled
testAuth.use('*', async (c, next) => {
  if (c.env.E2E_TEST_MODE !== 'true') {
    return c.json({ error: 'Test endpoints are disabled' }, 403);
  }
  return next();
});

/**
 * POST /api/test/auth
 *
 * Creates a test user and session, returning a session token.
 * The user is created if it doesn't exist, or reused if it does.
 *
 * Request body:
 * - email: string (required) - Email for the test user
 * - name: string (optional) - Display name for the test user
 * - role: 'student' | 'tutor' (optional) - users.role (a tutor account gets the tutor-first app)
 * - is_admin: boolean (optional) - make the user an admin
 *
 * Response:
 * - session_token: string - Session token to use for authenticated requests
 * - user: User - The created/existing user object
 */
testAuth.post('/auth', async (c) => {
  const body = await c.req.json<{ email: string; name?: string; role?: 'student' | 'tutor'; is_admin?: boolean }>();

  if (!body.email) {
    return c.json({ error: 'Email is required' }, 400);
  }

  const db = c.env.DB;

  // Check if test user already exists
  let user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(body.email)
    .first<User>();

  if (!user) {
    // Create new test user
    const id = crypto.randomUUID();
    await db
      .prepare(`
        INSERT INTO users (id, email, google_id, name, picture_url, role, is_admin, last_login_at)
        VALUES (?, ?, ?, ?, NULL, 'student', 0, datetime('now'))
      `)
      .bind(
        id,
        body.email,
        `test-${id}`, // Fake Google ID for test users
        body.name || 'Test User'
      )
      .run();

    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  } else {
    // Update last login
    await db
      .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
      .bind(user.id)
      .run();
  }

  // Optional role / admin flag, so specs can seed a tutor account or an admin.
  if (body.role === 'student' || body.role === 'tutor' || typeof body.is_admin === 'boolean') {
    await db
      .prepare('UPDATE users SET role = COALESCE(?, role), is_admin = COALESCE(?, is_admin) WHERE id = ?')
      .bind(body.role ?? null, typeof body.is_admin === 'boolean' ? (body.is_admin ? 1 : 0) : null, user!.id)
      .run();
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user!.id).first<User>();
  }

  // Create session for the user
  const session = await createSession(db, user!.id);

  return c.json({
    session_token: session.id,
    user: user,
  });
});

/**
 * POST /api/test/cleanup
 *
 * Cleans up test data - removes test users and their associated data.
 * Only removes users with emails ending in @test.e2e or with google_id starting with 'test-'.
 */
/**
 * POST /api/test/homework-draft — a FINISHED lesson-notes draft without running
 * the agent (E2E + screenshots): a lesson-log entry and a review job whose
 * result points at the tutor's deck (and library lessons) given.
 * Body: { relationship_id, deck_id, deck_name?, library_items?: [{ id, title, exercise_count? }], title?, notes?, summary?, skipped? }
 */
testAuth.post('/homework-draft', async (c) => {
  const b = await c.req.json<{ relationship_id: string; deck_id?: string; deck_name?: string; library_items?: Array<{ id: string; title: string; exercise_count?: number }>; title?: string; notes?: string; summary?: string; skipped?: string[] }>();
  const rel = await c.env.DB.prepare('SELECT * FROM tutor_relationships WHERE id = ?').bind(b.relationship_id).first<{ requester_id: string; recipient_id: string; requester_role: string }>();
  if (!rel) return c.json({ error: 'relationship not found' }, 404);
  const tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
  const studentId = rel.requester_role === 'tutor' ? rel.recipient_id : rel.requester_id;
  const notes = b.notes ?? 'Restaurant lesson: 菜单, 服务员, 点菜, 买单. 把 sentences: 把菜单给我。';
  const entry = await insightsQ.createLessonLogEntry(c.env.DB, { relationship_id: b.relationship_id, tutor_id: tutorId, student_id: studentId, lesson_at: new Date().toISOString(), notes: b.title ? `${b.title}\n${notes}` : notes, title: b.title ?? null });
  const job = await tutorJobs.createJob(c.env.DB, { relationship_id: b.relationship_id, tutor_id: tutorId, student_id: studentId, title: b.title ?? null, notes, lesson_at: entry.lesson_at, priority: 'core', auto_share: false, lesson_log_id: entry.id, review: true });
  const count = b.deck_id ? ((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE deck_id = ?').bind(b.deck_id).first<{ n: number }>())?.n ?? 0) : 0;
  const summary = b.summary ?? 'Made a deck of the words from the lesson and a short 把 lesson.';
  const at = new Date().toISOString();
  await tutorJobs.patchJob(c.env.DB, job.id, {
    status: 'done',
    progress: 'Draft ready',
    finished_at: at,
    result: {
      ...(b.deck_id ? { deck: { id: b.deck_id, name: b.deck_name ?? 'Draft deck', note_count: count } } : {}),
      lessons: (b.library_items ?? []).map((l) => ({ library_item_id: l.id, title: l.title, exercise_count: l.exercise_count ?? 2 })),
      summary,
      skipped: b.skipped ?? [],
    },
    chat: [{ role: 'assistant', text: summary, at }],
    steps: [{ at, kind: 'done', text: 'Draft ready for review' }],
  });
  return c.json({ job_id: job.id, lesson_log_id: entry.id });
});

testAuth.post('/cleanup', async (c) => {
  const db = c.env.DB;

  // Get test user IDs
  const testUsers = await db
    .prepare(`
      SELECT id FROM users
      WHERE email LIKE '%@test.e2e' OR google_id LIKE 'test-%'
    `)
    .all<{ id: string }>();

  const userIds = testUsers.results.map((u) => u.id);

  if (userIds.length === 0) {
    return c.json({ deleted: 0 });
  }

  // Delete in order to respect foreign key constraints
  const placeholders = userIds.map(() => '?').join(',');

  // Delete review events
  await db
    .prepare(`DELETE FROM review_events WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .run();

  // Delete cards (via notes via decks)
  await db
    .prepare(`
      DELETE FROM cards WHERE note_id IN (
        SELECT n.id FROM notes n
        JOIN decks d ON n.deck_id = d.id
        WHERE d.user_id IN (${placeholders})
      )
    `)
    .bind(...userIds)
    .run();

  // Delete notes (via decks)
  await db
    .prepare(`
      DELETE FROM notes WHERE deck_id IN (
        SELECT id FROM decks WHERE user_id IN (${placeholders})
      )
    `)
    .bind(...userIds)
    .run();

  // Delete decks
  await db.prepare(`DELETE FROM decks WHERE user_id IN (${placeholders})`).bind(...userIds).run();

  // Delete sessions
  await db
    .prepare(`DELETE FROM auth_sessions WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .run();

  // Delete users
  await db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).bind(...userIds).run();

  return c.json({ deleted: userIds.length });
});

export default testAuth;
