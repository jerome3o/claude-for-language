import { Env, User, AuthSession } from '../types';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture: string;
  locale?: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getGoogleAuthUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  return response.json();
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Google');
  }

  return response.json();
}

export async function getOrCreateUser(
  db: D1Database,
  googleUser: GoogleUserInfo,
  isAdminEmail: boolean
): Promise<{ user: User; isNewUser: boolean }> {
  // Check if user exists by google_id
  let user = await db
    .prepare('SELECT * FROM users WHERE google_id = ?')
    .bind(googleUser.id)
    .first<User>();

  if (user) {
    // Update last login and potentially other fields
    await db
      .prepare(`
        UPDATE users SET
          last_login_at = datetime('now'),
          name = ?,
          picture_url = ?,
          email = ?,
          is_admin = ?
        WHERE id = ?
      `)
      .bind(
        googleUser.name,
        googleUser.picture,
        googleUser.email,
        isAdminEmail ? 1 : user.is_admin,
        user.id
      )
      .run();

    // Fetch updated user
    user = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first<User>();

    return { user: user!, isNewUser: false };
  }

  // Check if user exists by email (migrating existing user)
  user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(googleUser.email)
    .first<User>();

  if (user) {
    // Link Google account to existing user
    await db
      .prepare(`
        UPDATE users SET
          google_id = ?,
          name = ?,
          picture_url = ?,
          is_admin = ?,
          last_login_at = datetime('now')
        WHERE id = ?
      `)
      .bind(
        googleUser.id,
        googleUser.name,
        googleUser.picture,
        isAdminEmail ? 1 : 0,
        user.id
      )
      .run();

    user = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first<User>();

    return { user: user!, isNewUser: false };
  }

  // Create new user
  const id = generateId();
  await db
    .prepare(`
      INSERT INTO users (id, email, google_id, name, picture_url, role, is_admin, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'student', ?, datetime('now'))
    `)
    .bind(
      id,
      googleUser.email,
      googleUser.id,
      googleUser.name,
      googleUser.picture,
      isAdminEmail ? 1 : 0
    )
    .run();

  user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>();

  return { user: user!, isNewUser: true };
}

export async function createSession(db: D1Database, userId: string): Promise<AuthSession> {
  const id = generateId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db
    .prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, expiresAt)
    .run();

  const session = await db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .bind(id)
    .first<AuthSession>();

  return session!;
}

export async function getSessionWithUser(
  db: D1Database,
  sessionId: string
): Promise<{ session: AuthSession; user: User } | null> {
  const session = await db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .bind(sessionId)
    .first<AuthSession>();

  if (!session) return null;

  // Check if session is expired
  if (new Date(session.expires_at) < new Date()) {
    // Clean up expired session
    await db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(session.user_id)
    .first<User>();

  if (!user) return null;

  return { session, user };
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run();
}

export async function cleanupExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
}

// Session cookie helpers
export function createSessionCookie(sessionId: string, secure: boolean = true): string {
  const maxAge = SESSION_DURATION_MS / 1000; // Convert to seconds
  const parts = [
    `session=${sessionId}`,
    `Path=/`,
    `HttpOnly`,
    // SameSite=None required for cross-origin cookies (frontend and API on different domains)
    `SameSite=${secure ? 'None' : 'Lax'}`,
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean = true): string {
  const parts = [
    'session=',
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`,
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'session' && value) {
      return value;
    }
  }
  return null;
}

// State cookie for OAuth CSRF protection
export function createStateCookie(state: string, secure: boolean = true): string {
  const parts = [
    `oauth_state=${state}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600', // 10 minutes
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearStateCookie(secure: boolean = true): string {
  const parts = [
    'oauth_state=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function parseStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'oauth_state' && value) {
      return value;
    }
  }
  return null;
}

export function generateState(): string {
  return generateId();
}

// Get all users for admin page
export async function getAllUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all<User>();
  return result.results;
}
