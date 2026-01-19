import { Context, Next } from 'hono';
import { Env, User } from '../types';
import { parseSessionCookie, getSessionWithUser } from '../services/auth';

// Extend Hono context to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/me', // Returns 401 if not authenticated, which is expected behavior
  '/api/oauth/', // MCP OAuth endpoints
];

// Routes that are public only for GET requests (e.g., serving audio files)
const PUBLIC_GET_ROUTES = [
  '/api/audio/', // Audio files are public for playback, but upload requires auth
];

function isPublicRoute(path: string, method: string): boolean {
  if (PUBLIC_ROUTES.some(route => path.startsWith(route))) {
    return true;
  }
  // Allow GET requests to audio routes (for playback) but require auth for POST (upload)
  if (method === 'GET' && PUBLIC_GET_ROUTES.some(route => path.startsWith(route))) {
    return true;
  }
  return false;
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const path = c.req.path;
  const method = c.req.method;

  // Skip auth for public routes
  if (isPublicRoute(path, method)) {
    return next();
  }

  // Get session from Authorization header or cookie
  let sessionId: string | null = null;
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7);
  } else {
    const cookieHeader = c.req.header('Cookie') || null;
    sessionId = parseSessionCookie(cookieHeader);
  }

  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Validate session and get user
  const result = await getSessionWithUser(c.env.DB, sessionId);

  if (!result) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Attach user to context
  c.set('user', result.user);

  return next();
}

// Middleware for admin-only routes
export async function adminMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const user = c.get('user');

  if (!user || !user.is_admin) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return next();
}
