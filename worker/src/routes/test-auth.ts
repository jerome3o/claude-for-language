import { Hono } from 'hono';
import { Env, User } from '../types';
import { createSession } from '../services/auth';

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
 *
 * Response:
 * - session_token: string - Session token to use for authenticated requests
 * - user: User - The created/existing user object
 */
testAuth.post('/auth', async (c) => {
  const body = await c.req.json<{ email: string; name?: string }>();

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
