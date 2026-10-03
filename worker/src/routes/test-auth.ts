import { autoCheckMessageInBackground } from '../services/chat/auto-check';
import { Hono } from 'hono';
import { Env, User } from '../types';
import { createSession } from '../services/auth';
import * as tutorJobs from '../db/tutor-notes-queries';
import * as insightsQ from '../db/insights-queries';
import * as huntDb from '../db/picture-hunt-queries';
import type { HuntObject } from '@shared/picture-hunt';

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
 * POST /api/test/session-notes-job — a FINISHED session-notes job (not a draft)
 * without running the agent: what the assistant made sits in the tutor's account
 * and nothing was sent (auto_share off, the default). E2E + screenshots.
 * Body: { relationship_id, deck_id, deck_name?, library_items?: [{ id, title, exercise_count? }], title?, summary? }
 */
testAuth.post('/session-notes-job', async (c) => {
  const b = await c.req.json<{ relationship_id: string; deck_id?: string; deck_name?: string; library_items?: Array<{ id: string; title: string; exercise_count?: number }>; title?: string; summary?: string }>();
  const rel = await c.env.DB.prepare('SELECT * FROM tutor_relationships WHERE id = ?').bind(b.relationship_id).first<{ requester_id: string; recipient_id: string; requester_role: string }>();
  if (!rel) return c.json({ error: 'relationship not found' }, 404);
  const tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
  const studentId = rel.requester_role === 'tutor' ? rel.recipient_id : rel.requester_id;
  const notes = 'Restaurant lesson: 菜单, 服务员, 点菜, 买单. 把 sentences: 把菜单给我。';
  const job = await tutorJobs.createJob(c.env.DB, { relationship_id: b.relationship_id, tutor_id: tutorId, student_id: studentId, title: b.title ?? null, notes, lesson_at: new Date().toISOString(), priority: 'core', auto_share: false, lesson_log_id: null });
  const count = b.deck_id ? ((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE deck_id = ?').bind(b.deck_id).first<{ n: number }>())?.n ?? 0) : 0;
  const at = new Date().toISOString();
  await tutorJobs.patchJob(c.env.DB, job.id, {
    status: 'done',
    progress: 'Done',
    finished_at: at,
    result: {
      ...(b.deck_id ? { deck: { id: b.deck_id, name: b.deck_name ?? 'Lesson deck', note_count: count } } : {}),
      lessons: (b.library_items ?? []).map((l) => ({ library_item_id: l.id, title: l.title, exercise_count: l.exercise_count ?? 2 })),
      summary: b.summary ?? 'Made a deck of the words from the lesson.',
      skipped: [],
    },
    steps: [{ at, kind: 'done', text: 'Done' }],
  });
  return c.json({ job_id: job.id });
});

/**
 * POST /api/test/homework-draft — a FINISHED lesson-notes draft without running
 * the agent (E2E + screenshots): a lesson-log entry and a review job whose
 * result points at the tutor's deck (and library lessons) given.
 * Body: { relationship_id, deck_id, deck_name?, library_items?: [{ id, title, exercise_count? }], title?, notes?, summary?, skipped? }
 */
testAuth.post('/homework-draft', async (c) => {
  const b = await c.req.json<{ relationship_id: string; deck_id?: string; deck_name?: string; library_items?: Array<{ id: string; title: string; exercise_count?: number }>; title?: string; notes?: string; summary?: string; skipped?: string[]; chat?: Array<{ role: 'tutor' | 'assistant'; text: string }> }>();
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
    chat: b.chat ? b.chat.map((m) => ({ ...m, at })) : [{ role: 'assistant', text: summary, at }],
    steps: [{ at, kind: 'done', text: 'Draft ready for review' }],
  });
  return c.json({ job_id: job.id, lesson_log_id: entry.id });
});

/**
 * POST /api/test/chat-auto-check — run the chat auto-check on a message with a
 * canned answer instead of Claude (E2E + screenshots): the real store +
 * `message_updated` path. Body: { message_id, result? } where result is the
 * check_message tool input (default: one 了 too many).
 */
testAuth.post('/chat-auto-check', async (c) => {
  const b = await c.req.json<{ message_id: string; result?: unknown }>();
  const row = await c.env.DB.prepare('SELECT content FROM messages WHERE id = ?').bind(b.message_id).first<{ content: string }>();
  if (!row) return c.json({ error: 'message not found' }, 404);
  const canned = b.result ?? {
    status: 'improvable',
    severity: 'minor',
    corrected: { hanzi: row.content.replace('去了', '去'), pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went to the shop to buy things yesterday.' },
    mistakes: [{
      quote: '去了', fix: '去', why: 'One 了 at the end is enough here — 去 and 买 are one action.',
      card: { hanzi: '去商店买东西', pinyin: 'qù shāngdiàn mǎi dōngxi', english: 'go to the shop to buy things', fun_facts: '去 (qù) go\n商店 (shāngdiàn) shop\n买 (mǎi) buy\n东西 (dōngxi) things\nVerb series: 去 + place + what you do there.' },
    }],
    alternative: { hanzi: '我昨天去商店买了点东西', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi le diǎn dōngxi', english: 'I bought a few things at the shop yesterday.', note: 'Sounds more natural in conversation.' },
    card: { hanzi: '我昨天去商店买东西了。', pinyin: 'wǒ zuótiān qù shāngdiàn mǎi dōngxi le', english: 'I went to the shop to buy things yesterday.', fun_facts: '我 (wǒ) I\n昨天 (zuótiān) yesterday\n去 (qù) go\n商店 (shāngdiàn) shop\n买 (mǎi) buy\n东西 (dōngxi) things\n了 (le) completed\nOne 了 at the end covers the whole series.' },
  };
  await c.env.DB.prepare('UPDATE messages SET auto_check = NULL WHERE id = ?').bind(b.message_id).run();
  const outcome = await autoCheckMessageInBackground(c.env, b.message_id, { check: async () => canned });
  return c.json({ outcome });
});

/**
 * POST /api/test/picture-hunt — a picture hunt without running the pipeline
 * (E2E + screenshots). Body: { user_id, title?, status?: ready|generating|error,
 * progress?, error?, objects?: HuntObject[], image_base64?, mime? }.
 */
testAuth.post('/picture-hunt', async (c) => {
  const b = await c.req.json<{ user_id: string; title?: string; prompt?: string; status?: 'ready' | 'generating' | 'error'; progress?: string; error?: string; objects?: HuntObject[]; image_base64?: string; mime?: string; width?: number; height?: number }>();
  const id = await huntDb.createPictureHunt(c.env.DB, { userId: b.user_id, title: b.title ?? 'Test hunt', source: 'generated', prompt: b.prompt ?? 'a busy kitchen', deckIds: null });
  if (b.image_base64) {
    const ext = b.mime === 'image/jpeg' ? 'jpg' : 'png';
    const key = huntDb.pictureHuntImageKey(id, ext);
    await c.env.AUDIO_BUCKET.put(key, Uint8Array.from(atob(b.image_base64), (ch) => ch.charCodeAt(0)), { httpMetadata: { contentType: b.mime ?? 'image/png' } });
    await huntDb.setPictureHuntImage(c.env.DB, id, key, b.width ?? 800, b.height ?? 600);
  }
  const status = b.status ?? 'ready';
  if (status === 'ready') await huntDb.setPictureHuntReady(c.env.DB, id, b.title ?? 'Test hunt', b.objects ?? []);
  else if (status === 'error') await huntDb.setPictureHuntError(c.env.DB, id, b.error ?? 'Finding the objects failed (Gemini 503)');
  if (b.progress) await huntDb.setPictureHuntProgress(c.env.DB, id, b.progress);
  return c.json({ id });
});

/**
 * POST /api/test/merged-chats — a pair's chat as migration 0102 leaves it after
 * merging older conversations (one chat per pair): the one conversation holding
 * every message, plus the merged-away rows pointing at it (old links / ids).
 * Body: { relationship_id, old_titles: string[], messages: [{ sender_id, content, created_at }] }
 * → { conversation_id, merged_ids }.
 */
testAuth.post('/merged-chats', async (c) => {
  const b = await c.req.json<{ relationship_id: string; old_titles?: string[]; messages?: Array<{ sender_id: string; content: string; created_at: string }> }>();
  const db = c.env.DB;
  const existing = await db
    .prepare("SELECT id FROM conversations WHERE relationship_id = ? AND merged_into IS NULL AND COALESCE(is_ai_conversation, 0) = 0")
    .bind(b.relationship_id)
    .first<{ id: string }>();
  const primary = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await db.prepare('INSERT INTO conversations (id, relationship_id, title) VALUES (?, ?, NULL)').bind(primary, b.relationship_id).run();
  }
  const mergedIds: string[] = [];
  for (const title of b.old_titles ?? []) {
    const id = crypto.randomUUID();
    mergedIds.push(id);
    await db.prepare('INSERT INTO conversations (id, relationship_id, title, merged_into) VALUES (?, ?, ?, ?)').bind(id, b.relationship_id, title, primary).run();
  }
  let last: string | null = null;
  for (const m of b.messages ?? []) {
    await db
      .prepare('INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), primary, m.sender_id, m.content, m.created_at)
      .run();
    if (!last || m.created_at > last) last = m.created_at;
  }
  if (last) await db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').bind(last, primary).run();
  return c.json({ conversation_id: primary, merged_ids: mergedIds });
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
