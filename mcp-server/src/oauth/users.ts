/**
 * Who a Google sign-in on the MCP server is, in the app's `users` table.
 *
 * The MCP server NEVER creates accounts: sign-up is invite-only and lives in
 * the app (worker `/api/auth/callback` → `resolveSignup`). A Google account
 * with no user row is refused and remembered as an access request, the same
 * row the web callback writes, so the admin sees it on the admin page.
 *
 * Matching by email (an account made before Google sign-in, or by an invite)
 * happens only when Google says the email is verified.
 */

export interface GoogleUserInfo {
  id: string;
  email?: string | null;
  verified_email?: boolean;
  name?: string | null;
  picture?: string | null;
}

export interface McpUser {
  id: string;
  email: string | null;
  name: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The existing user for this Google account, or null (→ refuse; never insert). */
export async function findMcpUser(db: D1Database, google: GoogleUserInfo): Promise<McpUser | null> {
  if (!google.id) return null;
  const byGoogleId = await db
    .prepare('SELECT id, email, name FROM users WHERE google_id = ?')
    .bind(google.id)
    .first<McpUser>();
  if (byGoogleId) return byGoogleId;

  if (!google.email || google.verified_email !== true) return null;
  return db
    .prepare('SELECT id, email, name FROM users WHERE email = ?')
    .bind(google.email)
    .first<McpUser>();
}

/**
 * Stamp the sign-in: link the Google id (an email match), remember Google's
 * name / picture, last_login_at. A name / picture the user set on their
 * Profile survives (worker services/profile.ts).
 */
export async function touchMcpUser(db: D1Database, user: McpUser, google: GoogleUserInfo): Promise<void> {
  await db
    .prepare(`
      UPDATE users SET
        google_id = ?,
        google_name = COALESCE(?, google_name),
        google_picture_url = COALESCE(?, google_picture_url),
        name = CASE WHEN name_custom = 1 OR ? IS NULL THEN name ELSE ? END,
        picture_url = CASE WHEN picture_source = 'google' AND ? IS NOT NULL THEN ? ELSE picture_url END,
        last_login_at = datetime('now')
      WHERE id = ?
    `)
    .bind(
      google.id,
      google.name ?? null,
      google.picture ?? null,
      google.name ?? null, google.name ?? null,
      google.picture ?? null, google.picture ?? null,
      user.id,
    )
    .run();
}

/**
 * Remember an uninvited sign-in attempt (worker db/invite-queries.ts
 * `recordAccessRequest`, same table and rules): one row per email, repeats
 * bump `attempts`; an 'approved' row goes back to 'pending', a dismissed one
 * stays dismissed.
 */
export async function recordAccessRequest(
  db: D1Database,
  person: { email: string; name?: string | null; picture_url?: string | null },
): Promise<void> {
  const email = normalizeEmail(person.email);
  const existing = await db
    .prepare('SELECT id, status, name, picture_url FROM access_requests WHERE email = ?')
    .bind(email)
    .first<{ id: string; status: string; name: string | null; picture_url: string | null }>();
  if (existing) {
    const nextStatus = existing.status === 'approved' ? 'pending' : existing.status;
    await db
      .prepare(`
        UPDATE access_requests
        SET attempts = attempts + 1, last_seen_at = datetime('now'), name = ?, picture_url = ?, status = ?
        WHERE id = ?
      `)
      .bind(person.name ?? existing.name, person.picture_url ?? existing.picture_url, nextStatus, existing.id)
      .run();
    return;
  }
  await db
    .prepare('INSERT INTO access_requests (id, email, name, picture_url) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), email, person.name ?? null, person.picture_url ?? null)
    .run();
}

/**
 * Whether the account behind a grant still exists. An admin deleting an
 * account (worker services/admin/delete-user.ts) can't reach this worker's
 * OAUTH_KV, so every MCP request and token refresh checks D1 instead.
 * Positive answers are cached per isolate for a minute (a deletion takes
 * effect within that); negative answers are never cached.
 */
const LIVE_CACHE_MS = 60_000;
const liveUsers = new Map<string, number>();

export async function userExists(db: D1Database, userId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!userId || typeof userId !== 'string') return false;
  const seen = liveUsers.get(userId);
  if (seen !== undefined && now - seen < LIVE_CACHE_MS) return true;
  const row = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<{ id: string }>();
  if (!row) {
    liveUsers.delete(userId);
    return false;
  }
  if (liveUsers.size > 1000) liveUsers.clear();
  liveUsers.set(userId, now);
  return true;
}

/** Tests only. */
export function clearLiveUserCache(): void {
  liveUsers.clear();
}
